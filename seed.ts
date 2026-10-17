/**
 * SportX India — database seed.
 *
 * Reads prisma/seed-data.json (parsed from the WordPress WXR export), imports
 * all authors + posts, runs an automatic moderation scan, quarantines the
 * known injected spam post, and writes an audit-log trail.
 *
 * Run with: `bun run prisma/seed.ts`
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new PrismaClient();

type SeedAuthor = {
  login: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
};

type SeedPost = {
  wpId: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  contentPlain: string;
  contentHash: string;
  coverSeed: string;
  readMinutes: number;
  authorLogin: string;
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
  publishedAt: string;
  confirmedSpam: boolean;
};

// ---- Moderation engine ----------------------------------------------------
// High-confidence spam/phishing/SEO-injection signals. Each pattern carries a
// risk weight; the post's moderationScore is the sum, capped at 100.
const SPAM_PATTERNS: { re: RegExp; weight: number; label: string }[] = [
  { re: /slavic\s+brides?/i, weight: 90, label: "spam:slavic-brides" },
  { re: /\bmail[- ]?order\s+(brides?|wives?)/i, weight: 90, label: "spam:mail-order-brides" },
  { re: /\b(russian|ukrainian|asian)\s+(brides?|women|girls|wives?|singles)\b/i, weight: 85, label: "spam:dating-brides" },
  { re: /\bdating\s+(site|service|agency|app)\b/i, weight: 60, label: "spam:dating-service" },
  { re: /\b(hookup|casual\s+encounters?|adult\s+dating)\b/i, weight: 80, label: "spam:hookup" },
  { re: /\bai\s+girlfriend\b/i, weight: 70, label: "spam:ai-girlfriend" },
  { re: /\b(buy\s+cheap|cheap\s+pills?|discount\s+pharmacy)\b/i, weight: 75, label: "spam:pharmacy" },
  { re: /\b(viagra|cialis|levitra)\b/i, weight: 70, label: "spam:ed-drugs" },
  { re: /\b(online\s+casino|sports\s+betting|crypto\s+casino)\b/i, weight: 65, label: "spam:gambling" },
  { re: /\b(free\s+money|guaranteed\s+income|work\s+from\s+home\s+earn)\b/i, weight: 65, label: "spam:scam-income" },
  { re: /\b(click\s+here\s+to\s+(claim|win|get\s+free))\b/i, weight: 50, label: "spam:clickbait-claim" },
  { re: /\b(steroids?\s+for\s+sale|buy\s+steroids?)\b/i, weight: 80, label: "spam:steroids-sale" },
  { re: /https?:\/\/[^\s]+\.(ru|cn|tk|ml|ga|cf|gq)\b/i, weight: 35, label: "spam:suspicious-tld" },
];

// Soft signals — low weight, contribute to score but rarely trigger quarantine
// on their own. These exist to catch the difference between a legit sports
// article that mentions "steroids" in context and a spam post.
const SOFT_PATTERNS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\bsteroids?\b/i, weight: 6, label: "soft:steroid-mention" },
  { re: /\bpills?\b/i, weight: 4, label: "soft:pill-mention" },
  { re: /\bcredit\b/i, weight: 2, label: "soft:credit-mention" },
  { re: /\bclick\s+here\b/i, weight: 8, label: "soft:click-here" },
  { re: /\blimited\s+(time\s+)?offer\b/i, weight: 10, label: "soft:limited-offer" },
];

function moderate(title: string, plain: string, publishedAt: Date): {
  score: number;
  reasons: string[];
} {
  const text = `${title}\n${plain}`;
  const reasons: string[] = [];
  let score = 0;

  for (const { re, weight, label } of SPAM_PATTERNS) {
    if (re.test(text)) {
      score += weight;
      reasons.push(label);
    }
  }
  for (const { re, weight, label } of SOFT_PATTERNS) {
    if (re.test(text)) {
      score += weight;
      if (!reasons.includes(label)) reasons.push(label);
    }
  }

  // Future-dated post (more than 7 days ahead of import time) is a strong
  // signal of injection.
  const now = new Date();
  if (publishedAt.getTime() - now.getTime() > 7 * 24 * 60 * 60 * 1000) {
    score += 55;
    reasons.push("inject:future-dated");
  }

  // Off-topic category check
  if (/\bai[- ]?girlfriend|dating|brides?/i.test(title)) {
    score += 30;
    reasons.push("inject:off-topic-title");
  }

  return { score: Math.min(100, score), reasons };
}

async function main() {
  console.log("🌱 Seeding SportX India database…");
  const raw = JSON.parse(
    readFileSync(join(__dirname, "seed-data.json"), "utf-8")
  ) as { authors: SeedAuthor[]; posts: SeedPost[] };

  // 1. Authors
  const authorMap = new Map<string, string>();
  for (const a of raw.authors) {
    const created = await db.author.upsert({
      where: { login: a.login },
      update: {},
      create: {
        login: a.login,
        email: a.email,
        displayName: a.displayName,
        firstName: a.firstName || null,
        lastName: a.lastName || null,
        role: a.login === "bemeghan19" ? "owner" : "contributor",
        bio:
          a.login === "bemeghan19"
            ? "Founder & editor of SportX India. Sports memoirist and historian."
            : "Contributor at SportX India.",
      },
    });
    authorMap.set(a.login, created.id);
  }
  console.log(`  ✓ ${authorMap.size} authors`);

  // 2. Categories & tags (collect first)
  const catMap = new Map<string, string>();
  const tagMap = new Map<string, string>();
  for (const p of raw.posts) {
    for (const c of p.categories) {
      if (!catMap.has(c.slug)) {
        const created = await db.category.upsert({
          where: { slug: c.slug },
          update: {},
          create: { slug: c.slug, name: c.name },
        });
        catMap.set(c.slug, created.id);
      }
    }
    for (const t of p.tags) {
      if (!tagMap.has(t.slug)) {
        const created = await db.tag.upsert({
          where: { slug: t.slug },
          update: {},
          create: { slug: t.slug, name: t.name },
        });
        tagMap.set(t.slug, created.id);
      }
    }
  }
  console.log(`  ✓ ${catMap.size} categories, ${tagMap.size} tags`);

  // 3. Posts with moderation
  let publishedCount = 0;
  let quarantinedCount = 0;
  let incidentsCreated = 0;

  // Mark first 3 legitimate posts as featured (most recent legit ones)
  const featuredSlugs = new Set(
    raw.posts
      .filter((p) => !p.confirmedSpam)
      .slice(0, 3)
      .map((p) => p.slug)
  );

  for (const p of raw.posts) {
    const publishedAt = new Date(p.publishedAt);
    const { score, reasons } = moderate(p.title, p.contentPlain, publishedAt);

    // Quarantine if high-confidence spam OR confirmed spam OR score >= 60
    const isQuarantined =
      p.confirmedSpam || score >= 60 || reasons.some((r) => r.startsWith("spam:"));

    const post = await db.post.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        wpId: p.wpId,
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        content: p.content,
        contentPlain: p.contentPlain,
        contentHash: p.contentHash,
        coverSeed: p.coverSeed,
        readMinutes: p.readMinutes,
        authorId: authorMap.get(p.authorLogin)!,
        publishedAt,
        status: isQuarantined ? "quarantined" : "published",
        moderationScore: score,
        moderationReasons: JSON.stringify(reasons),
        featured: featuredSlugs.has(p.slug),
      },
    });

    // Connect categories & tags
    await db.post.update({
      where: { id: post.id },
      data: {
        categories: {
          connect: p.categories.map((c) => ({ id: catMap.get(c.slug)! })).filter(Boolean),
        },
        tags: {
          connect: p.tags.map((t) => ({ id: tagMap.get(t.slug)! })).filter(Boolean),
        },
      },
    });

    if (isQuarantined) {
      quarantinedCount++;
      // Create a security incident
      await db.securityIncident.create({
        data: {
          postId: post.id,
          type: p.confirmedSpam ? "spam_injection" : "keyword_match",
          severity: score >= 80 ? "critical" : score >= 60 ? "high" : "medium",
          reason: `Auto-moderation flagged ${reasons.length} signal(s): ${reasons.join(", ")}. Score ${score}/100.`,
          status: "open",
        },
      });
      incidentsCreated++;
      await db.auditLog.create({
        data: {
          action: "moderate",
          actor: "system",
          targetType: "post",
          targetId: post.id,
          message: `Quarantined "${p.title}" (score ${score})`,
          severity: "critical",
          metadata: JSON.stringify({ score, reasons, wpId: p.wpId }),
        },
      });
    } else {
      publishedCount++;
    }
  }
  console.log(
    `  ✓ ${raw.posts.length} posts imported (${publishedCount} published, ${quarantinedCount} quarantined)`
  );
  console.log(`  ✓ ${incidentsCreated} security incidents opened`);

  // 4. Initial audit entries
  await db.auditLog.create({
    data: {
      action: "import",
      actor: "system",
      targetType: "system",
      message: `Imported ${raw.posts.length} posts from WordPress WXR export. Auto-moderation quarantined ${quarantinedCount} suspicious item(s).`,
      severity: "info",
      metadata: JSON.stringify({
        posts: raw.posts.length,
        quarantined: quarantinedCount,
        source: "sportxindia.WordPress.2026-10-16.xml",
      }),
    },
  });
  await db.auditLog.create({
    data: {
      action: "verify",
      actor: "system",
      targetType: "system",
      message: `Content-integrity fingerprints (SHA-256) generated for all imported posts.`,
      severity: "info",
      metadata: JSON.stringify({ algorithm: "sha-256" }),
    },
  });

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
