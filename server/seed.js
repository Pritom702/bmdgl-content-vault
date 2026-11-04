import fs from 'node:fs';
import path from 'node:path';
import { db, tx } from './db.js';
import { config, ROOT } from './config.js';
import { createUser } from './auth.js';

export function seedIfEmpty() {
  if (process.env.NO_SEED === '1') return;

  // 1. Seed default team accounts if no users exist yet
  let adminId = null;
  let sharafatId = null;
  let editorId = null;
  const existingUsers = db.prepare('SELECT id, email FROM users').all();
  if (existingUsers.length === 0) {
    adminId = createUser({ name: 'Pritom (Admin)', email: 'pritom@brightmind.com', password: 'password123', role: 'admin' });
    sharafatId = createUser({ name: 'Sharafat', email: 'sharafat@brightmind.com', password: 'password123', role: 'admin' });
    editorId = createUser({ name: 'Content Team', email: 'team@brightmind.com', password: 'password123', role: 'member' });
    console.log('[seed] Created default team accounts (pritom@brightmind.com, sharafat@brightmind.com, team@brightmind.com).');
  } else {
    adminId = existingUsers[0].id;
    sharafatId = existingUsers[1]?.id || adminId;
    editorId = existingUsers[2]?.id || adminId;
  }

  const itemCount = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  if (itemCount > 0) return;

  // Create default team collections if empty
  const collCount = db.prepare('SELECT COUNT(*) AS n FROM collections').get().n;
  let colls = {};
  if (collCount === 0) {
    const insC = db.prepare('INSERT INTO collections(name, description, emoji) VALUES (?, ?, ?)');
    colls.hooks = Number(insC.run('Scroll-Stopping Hooks', 'Best opening 3-second hooks for Reels & Shorts', '🎯').lastInsertRowid);
    colls.ai = Number(insC.run('AI Tools & Automation', 'Video editing, SFX, prompts & workflow tools', '🤖').lastInsertRowid);
    colls.fcomm = Number(insC.run('F-Commerce Growth & Ads', 'High-converting ad formats, audits & Bangladesh SME case studies', '🚀').lastInsertRowid);
    colls.skool = Number(insC.run('Skool & YouTube Drops', 'Lead magnets, Drive folders & "comment keyword" resources', '📦').lastInsertRowid);
  } else {
    for (const c of db.prepare('SELECT id, name FROM collections').all()) {
      if (c.name.includes('Hook')) colls.hooks = c.id;
      if (c.name.includes('AI')) colls.ai = c.id;
      if (c.name.includes('F-Commerce')) colls.fcomm = c.id;
      if (c.name.includes('Skool')) colls.skool = c.id;
    }
  }

  // Copy real reference videos & images from workspace if available so demo items play natively right away!
  const mediaDir = path.join(config.dataDir, 'media');
  const thumbDir = path.join(config.dataDir, 'thumbs');
  const copyIfExists = (srcAbs, destSub, destName) => {
    try {
      if (fs.existsSync(srcAbs)) {
        const dest = path.join(config.dataDir, destSub, destName);
        fs.copyFileSync(srcAbs, dest);
        return `${destSub}/${destName}`;
      }
    } catch { /* ignore */ }
    return null;
  };

  const refReelMedia = copyIfExists(path.resolve(ROOT, '../references/ref_reel_2026-10-29.mp4'), 'media', 'seed-ref-reel.mp4');
  const adBMedia = copyIfExists(path.resolve(ROOT, '../bmdgl-week1-content/AdB_FreeAudit_15s_9x16.mp4'), 'media', 'seed-adb-15s.mp4');
  const adCMedia = copyIfExists(path.resolve(ROOT, '../bmdgl-week1-content/AdC_FreeAudit_Story_v3_54s_9x16.mp4'), 'media', 'seed-adc-story.mp4');
  const post1Thumb = copyIfExists(path.resolve(ROOT, '../bmdgl-week1-content/01_Post1_FreeAudit_4x5.png'), 'thumbs', 'seed-post1.png');
  const post3Thumb = copyIfExists(path.resolve(ROOT, '../bmdgl-week1-content/03_Post3_GetOnline_4x5.png'), 'thumbs', 'seed-post3.png');
  const post5Thumb = copyIfExists(path.resolve(ROOT, '../bmdgl-week1-content/05_Post5_ConnectTeaser_4x5.png'), 'thumbs', 'seed-post5.png');
  const post6Thumb = copyIfExists(path.resolve(ROOT, '../bmdgl-week1-content/06_Post6_ThaiOrigins_Testimonial_4x5.png'), 'thumbs', 'seed-thai-origins.png');

  const seedItems = [
    {
      url: 'https://www.instagram.com/reel/DC9xTechDailyAI/',
      canonical_url: 'https://www.instagram.com/reel/DC9xTechDailyAI/',
      platform: 'instagram',
      content_type: 'reel',
      title: '3 Free AI Sound Effect Tools for Motion Graphics & Video Editing (Openverse, Real SFX, Earshot)',
      title_source: 'ai',
      author_name: '@techdaily.ai',
      caption: 'Claude has now become insanely good at motion graphics and video editing, but the sound effects it adds still suck. To fix that use these three free tools that add professional sounds to your timeline at the right place and the right level. Comment "SOUND" down below and I\'ll send you the links directly!',
      thumb_path: post5Thumb,
      media_path: refReelMedia,
      media_mime: refReelMedia ? 'video/mp4' : null,
      media_source: refReelMedia ? 'archive' : null,
      archive_status: refReelMedia ? 'done' : 'none',
      duration: 38.0,
      notes: 'Exact reference reel from our folder! Great example of a Problem -> 3 Tools -> Comment Keyword CTA structure. Plays right inside the Vault.',
      category: 'AI Tools',
      category_locked: 1,
      status: 'used',
      resource_status: 'received',
      comment_keyword: 'SOUND',
      ai_status: 'done',
      ai_source: 'video',
      usefulness: 10,
      summary: 'Demonstrates how to fix weak AI-generated audio in programmatic video editing using three tools: Openverse API (5M+ CC0 sounds), Real SFX (frame-accurate timeline placement), and Earshot (procedural code-generated SFX kits). Ends with a "comment SOUND" auto-DM trigger.',
      what_it_does: 'Gives our video & motion-graphics workflow automatic, frame-accurate sound design without manual timeline scrubbing, and models a high-converting comment-keyword lead magnet.',
      hook_text: 'Claude has now become insanely good at motion graphics and video editing, but the sound effects it adds still suck.',
      ai: {
        title: '3 Free AI Sound Effect Tools for Motion Graphics & Video Editing',
        summary: 'Demonstrates how to fix weak AI-generated audio in programmatic video editing using three tools: Openverse API (5M+ CC0 sounds), Real SFX (frame-accurate timeline placement), and Earshot (procedural code-generated SFX kits). Ends with a "comment SOUND" auto-DM trigger.',
        what_it_does: 'Gives our video & motion-graphics workflow automatic, frame-accurate sound design without manual timeline scrubbing, and models a high-converting comment-keyword lead magnet.',
        content_type: 'reel',
        category: 'AI Tools',
        tags: ['ai-video', 'sound-effects', 'motion-graphics', 'comment-cta', 'openverse', 'reel-structure'],
        key_takeaways: [
          'Call out a specific flaw in a trending tool ("Claude is great at motion graphics, BUT its sound effects suck") to create instant curiosity.',
          'Stack 3 escalated solutions: 1) search library (Openverse), 2) smart auto-placement (Real SFX), 3) custom generation (Earshot).',
          'Keep total runtime under 40 seconds with visual cuts every 2.5 seconds.',
          'Use a single-word comment trigger ("SOUND") to boost algorithmic comment weight while building a DM list.',
        ],
        hook: {
          text: 'Claude has now become insanely good at motion graphics and video editing, but the sound effects it adds still suck.',
          type: 'Contrarian / Flaw in Trending Tool',
          visual: 'Fast split-screen showing slick AI motion graphics paired with a visual red X over flat audio waveforms.',
          why_it_works: 'Validates what creators already love (AI motion graphics) while immediately agitating a painful bottleneck they have experienced.',
        },
        story: {
          structure: 'Hook (0-5s) → Agitate Problem → Tool 1: Openverse API (11-20s) → Tool 2: Real SFX (20-28s) → Tool 3: Earshot (28-35s) → Comment CTA (35-38s)',
          beats: [
            '0:00 - Hook: Praise AI video editing, call out bad SFX',
            '0:05 - Promise: 3 free tools that place pro sounds at the exact frame & level',
            '0:11 - Tool 1: Openverse API (5M+ searchable sound effects for AI agents)',
            '0:20 - Tool 2: Real SFX (analyzes timeline & drops SFX on exact frames)',
            '0:28 - Tool 3: Earshot (generates custom sound kits in code)',
            '0:35 - Payoff + CTA: Comment "SOUND" to get all 3 links via DM',
          ],
        },
        payoff: 'Viewers get a complete 3-layer sound-design stack (search, auto-sync, custom synth) in 35 seconds with zero fluff.',
        cta: 'Comment "SOUND" down below and I\'ll send you the links directly + follow @techdaily.ai',
        comment_keyword: 'SOUND',
        tools_mentioned: [
          { name: 'Openverse API', purpose: 'Gives AI agents access to 5M+ royalty-free sound effects', url: 'https://api.openverse.org/' },
          { name: 'Real SFX', purpose: 'Studies video timeline and places sound effects at the exact frame', url: '' },
          { name: 'Earshot', purpose: 'Generates custom procedural sound effects and sound kits in code', url: '' },
        ],
        prompts_detected: [
          'Use Openverse API to search CC0 Foley & whoosh SFX matching each scene transition timestamp, normalize peaks to -12 dBFS, and mix under dialogue bed.',
        ],
        transcript: '[0.0] Claude has now become insanely good at motion graphics and video editing, but the sound effects it adds still suck. [5.5] To fix that use these three free tools that add professional sounds to your timeline at the right place and the right level [11.5] just like a pro editor would. The first is Openverse API [14.6] which gives your AI agent access to over five million high-quality sound effects that it can search and download on its own. [20.4] The second is Real SFX which studies your timeline, finds each moment that needs a sound, and adds one at the exact frame. [28.2] And finally if it still can\'t find the right sound effect, use Earshot to generate a brand new one in code [33.3] or even a whole sound kit that fits your project. [35.6] So if you want all three of these, just comment SOUND down below and I\'ll send you the links directly.',
        how_to_adapt: [
          'Create a Bangla Reel for F-commerce sellers: "ক্যানভা দিয়ে দারুণ পোস্ট বানাচ্ছেন, কিন্তু অর্ডার আসছে না? কারণ এই ৩টি জিনিস মিস করছেন!"',
          'Use the exact 3-tool ladder structure for BMDGL services: 1) Free Page Audit, 2) Bright Mind Connect unified inbox, 3) Automated Order SMS.',
          'End every educational Reel with a 1-word comment trigger ("AUDIT" or "CHECKLIST") so comments spike organic reach.',
        ],
        bangla_hooks: [
          'আপনার এআই ভিডিও দেখতে দারুণ, কিন্তু সাউন্ড শুনলে সস্তা লাগে? এই ৩টি ফ্রি টুল দেখুন!',
          'ফেসবুক পেজে প্রতিদিন পোস্ট করছেন, কিন্তু রিচ ৩ জনের বেশি না? আসল কারণটা শুনুন।',
          'মাত্র ৩৫ সেকেন্ডে আপনার ভিডিও এডিটিং প্রো লেভেলে নিয়ে যান—কমেন্টে লিখুন SOUND!',
        ],
        usefulness: 10,
        confidence: 'high',
        analysis_basis: 'full video',
      },
      tags: ['ai-video', 'sound-effects', 'motion-graphics', 'comment-cta', 'openverse', 'reel-structure'],
      collections: [colls.hooks, colls.ai, colls.skool].filter(Boolean),
      resources: [
        {
          kind: 'tool',
          title: 'Openverse Audio API (5M+ CC0 SFX)',
          content: 'REST endpoint: https://api.openverse.org/v1/audio/?q=whoosh&license_type=all-cc — no paid key needed for basic queries.',
          url: 'https://api.openverse.org/',
        },
        {
          kind: 'prompt',
          title: 'Timeline SFX Auto-Sync Prompt (Claude / Cursor)',
          content: 'Analyze the scene timestamps in build3.py. For every visual transition, title pop, and lower-third entrance, pick a matching CC0 sound effect (whoosh, pop, subtle click, cafe ambience bed), duck background bed by -14dB under dialogue, and export a frame-accurate mix script.',
          url: '',
        },
      ],
    },
    {
      url: 'https://bmdgl.brightmindpro.com/#audit-story-v3',
      canonical_url: 'https://bmdgl.brightmindpro.com/#audit-story-v3',
      platform: 'facebook',
      content_type: 'reel',
      title: 'BMDGL Free Page Audit — 54s Story Ad v3 (Hook → 3 Page Leaks → Free Audit Payoff)',
      title_source: 'user',
      author_name: 'Bright Mind Digital Growth Lab',
      caption: 'আপনার ফেসবুক পেজে ফলোয়ার আছে, কিন্তু ইনবক্সে অর্ডার নেই? ৫৪ সেকেন্ডের এই স্টোরিতে দেখুন কীভাবে ফ্রি পেজ অডিট আপনার পেজের ৩টি বড় ভুল ধরিয়ে দেয়। ফ্রি অডিট পেতে WhatsApp করুন: +880 1965-059108',
      thumb_path: post1Thumb,
      media_path: adCMedia,
      media_mime: adCMedia ? 'video/mp4' : null,
      media_source: adCMedia ? 'upload' : null,
      archive_status: adCMedia ? 'done' : 'none',
      duration: 54.0,
      notes: 'Our in-house 54-second narrative reel (v3) built for the Free Audit campaign. Uses dialogue + cafe ambience + Bangla hook.',
      category: 'Storytelling & Scripts',
      category_locked: 1,
      status: 'testing',
      resource_status: 'received',
      comment_keyword: 'AUDIT',
      ai_status: 'done',
      ai_source: 'video',
      usefulness: 10,
      summary: 'A 54-second narrative story reel in Bangla where two business owners in a cafe discuss why Facebook boosting fails without fixing page fundamentals, leading into BMDGL\'s Free Page Audit offer.',
      what_it_does: 'Serves as our flagship storytelling template: relatable founder dialogue + concrete diagnosis of 3 page leaks + zero-risk Free Audit CTA.',
      hook_text: 'পেজে বুস্ট করে টাকা নষ্ট করছেন? আগে দেখুন আপনার পেজে এই ৩টা ছিদ্র আছে কি না!',
      ai: {
        title: 'BMDGL Free Page Audit — 54s Story Ad v3',
        summary: 'A 54-second narrative story reel in Bangla where two business owners in a cafe discuss why Facebook boosting fails without fixing page fundamentals, leading into BMDGL\'s Free Page Audit offer.',
        what_it_does: 'Serves as our flagship storytelling template: relatable founder dialogue + concrete diagnosis of 3 page leaks + zero-risk Free Audit CTA.',
        content_type: 'reel',
        category: 'Storytelling & Scripts',
        tags: ['bangla-reel', 'free-audit', 'story-ad', 'f-commerce', 'bmdgl'],
        key_takeaways: [
          'Dialogue between two characters feels like native entertainment rather than a corporate ad.',
          'Naming specific problems (missing pinned offer, slow inbox reply, broken trust signals) builds instant authority.',
          'Offering a Free 24-Hour Page Audit removes all buyer friction compared to pitching 13 services cold.',
        ],
        hook: {
          text: 'পেজে বুস্ট করে টাকা নষ্ট করছেন? আগে দেখুন আপনার পেজে এই ৩টা ছিদ্র আছে কি না!',
          type: 'Loss-Aversion Question + Specific Number',
          visual: '9:16 vertical scene with bold Bangla headline and immediate character reaction in first 1.5s.',
          why_it_works: 'Every Bangladeshi F-commerce seller who has boosted a post with poor ROI feels personally called out in the first 2 seconds.',
        },
        story: {
          structure: 'Relatable Frustration (0-7s) → Peer Diagnosis (7-25s) → The 3 Fixes (25-42s) → Proof & Free Audit CTA (42-54s)',
          beats: [
            '0:00 - Hook: Boosting without conversions problem',
            '0:08 - Story: Cafe conversation — why customers leave a page within 5 seconds',
            '0:22 - Breakdown: Bio/CTA setup, pinned value post, WhatsApp auto-reply speed',
            '0:44 - Payoff: Free Page Audit from Bright Mind Digital Growth Lab (+880 1965-059108)',
          ],
        },
        payoff: 'Viewer learns the exact 3 conversion leaks killing their ad spend and can claim a custom audit for free.',
        cta: 'কমেন্টে লিখুন "AUDIT" অথবা WhatsApp করুন +880 1965-059108',
        comment_keyword: 'AUDIT',
        tools_mentioned: [
          { name: 'FFmpeg + Python Build Pipeline', purpose: 'Automated 9:16 scene assembly and audio ducking', url: '' },
          { name: 'WhatsApp Business Quick Replies', purpose: '/audit-received and /audit-sent instant SLA workflow', url: '' },
        ],
        prompts_detected: [
          'Write a 50-second Bangla two-person cafe dialogue script for Bangladeshi F-commerce owners frustrated with Facebook boost results, transitioning naturally into a Free Page Audit.',
        ],
        transcript: 'পেজে বুস্ট করে টাকা নষ্ট করছেন? আগে দেখুন আপনার পেজে এই ৩টা ছিদ্র আছে কি না! কাস্টমার অ্যাডে ক্লিক করে পেজে আসে ঠিকই, কিন্তু বায়ো, পিন পোস্ট আর ইনবক্স অটোমেশন ঠিক না থাকায় ৭০% কাস্টমার অর্ডার না করেই চলে যায়। Bright Mind Digital Growth Lab থেকে আপনার পেজের ফ্রি অডিট রিপোর্ট নিন আজই।',
        how_to_adapt: [
          'Cut the first 15 seconds into a standalone fast-paced Remix Reel for Instagram & TikTok.',
          'Follow up with a live screen-recording showing a real anonymized audit report from Free_Audit_Report_TEMPLATE.docx.',
        ],
        bangla_hooks: [
          'ডলার খরচ করে বুস্ট করছেন, কিন্তু ইনবক্সে শুধু "Price please" মেসেজ? সমাধান দেখুন!',
          'আপনার ফেসবুক পেজের এই ৩টি ভুলের কারণে কাস্টমার দেখেও অর্ডার করছে না!',
          'ফ্রি পেজ অডিটে আমরা যা যা চেক করি—দেখুন ৫৪ সেকেন্ডে।',
        ],
        usefulness: 10,
        confidence: 'high',
        analysis_basis: 'full video',
      },
      tags: ['bangla-reel', 'free-audit', 'story-ad', 'f-commerce', 'bmdgl'],
      collections: [colls.hooks, colls.fcomm].filter(Boolean),
      resources: [
        {
          kind: 'prompt',
          title: 'Bangla F-Commerce Story Reel Script Prompt',
          content: 'Act as a top Bangladeshi direct-response creative director. Write a 45-second 2-character Bangla dialogue reel between two Dhaka F-commerce founders. Character A complains that boosting costs more every month with fewer orders. Character B reveals the "Leaky Bucket" principle (3 page mistakes) and shows how a Free BMDGL Page Audit fixed their conversion rate in 48 hours. Include on-screen Bangla text hooks and timestamped visual cues.',
          url: '',
        },
        {
          kind: 'drive',
          title: 'BMDGL Week-1 Creative & Ad Drive Folder',
          content: 'Contains Feed 4:5, Stories 9:16, and 15s/37s/54s video creatives ready for Meta Ads Manager.',
          url: 'https://drive.google.com/drive/folders/1r79ddBWDrvlPf9-zIF7q06LNE71rnzHM',
        },
      ],
    },
    {
      url: 'https://bmdgl.brightmindpro.com/#audit-15s-ad',
      canonical_url: 'https://bmdgl.brightmindpro.com/#audit-15s-ad',
      platform: 'facebook',
      content_type: 'reel',
      title: 'Ad B — 15s Fast-Hook Vertical Video (3 Quick Page Fixes → Free Audit CTA)',
      title_source: 'user',
      author_name: 'Bright Mind Digital Growth Lab',
      caption: 'মাত্র ১৫ সেকেন্ডে জেনে নিন আপনার বিজনেস পেজের ৩টি জরুরি ফিক্স! ফ্রি অডিট পেতে মেসেজ দিন: +880 1965-059108',
      thumb_path: post6Thumb,
      media_path: adBMedia,
      media_mime: adBMedia ? 'video/mp4' : null,
      media_source: adBMedia ? 'upload' : null,
      archive_status: adBMedia ? 'done' : 'none',
      duration: 15.0,
      notes: '15-second high-retention vertical ad designed for Reels & Stories placement (৳3,500/day x 7 days test budget).',
      category: 'Ads & Funnels',
      category_locked: 1,
      status: 'testing',
      resource_status: 'received',
      comment_keyword: '',
      ai_status: 'done',
      ai_source: 'video',
      usefulness: 9,
      summary: 'Ultra-tight 15-second 9:16 vertical video ad delivering a 2-second Bangla problem hook, 3 rapid visual fixes (bio/branding, content plan, inbox speed), and a direct WhatsApp CTA for the Free Audit.',
      what_it_does: 'Maximizes completion rate (>65% target) on cold Meta Reels/Stories traffic and drives low-cost WhatsApp conversations.',
      hook_text: 'পেজে সেল কম? ৩টি সহজ পরিবর্তনেই অর্ডার বাড়ান!',
      ai: {
        title: 'Ad B — 15s Fast-Hook Vertical Video',
        summary: 'Ultra-tight 15-second 9:16 vertical video ad delivering a 2-second Bangla problem hook, 3 rapid visual fixes, and a direct WhatsApp CTA.',
        what_it_does: 'Maximizes completion rate on cold Meta Reels/Stories traffic and drives direct WhatsApp leads.',
        content_type: 'reel',
        category: 'Ads & Funnels',
        tags: ['15s-ad', 'meta-ads', 'whatsapp-funnel', 'f-commerce', 'short-form'],
        key_takeaways: [
          '15-second ads work best when each point gets 3 seconds max and on-screen text carries the message even on mute.',
          'Always display the WhatsApp number (+880 1965-059108) and website (bmdgl.brightmindpro.com) clearly on the end card.',
        ],
        hook: {
          text: 'পেজে সেল কম? ৩টি সহজ পরিবর্তনেই অর্ডার বাড়ান!',
          type: 'Direct Question + 3-Step Promise',
          visual: 'High-contrast Bangla typography with rapid zoom-in and kinetic cards.',
          why_it_works: 'Zero wasted frames—viewers know the topic and the reward within 1.8 seconds.',
        },
        story: {
          structure: 'Hook (0-3s) → Fix 1, 2, 3 (3-11s) → Free Audit WhatsApp CTA (11-15s)',
          beats: [
            '0:00 - Hook: Low sales on your page?',
            '0:03 - 3 rapid-fire visual fixes for F-commerce pages',
            '0:11 - Call to Action: Free Audit via WhatsApp +880 1965-059108',
          ],
        },
        payoff: '3 actionable checklist items in 10 seconds + free personalized audit.',
        cta: 'WhatsApp +880 1965-059108 for Free Page Audit',
        comment_keyword: '',
        tools_mentioned: [
          { name: 'Meta Ads Manager (Click-to-WhatsApp)', purpose: 'Direct lead generation campaign objective', url: '' },
        ],
        prompts_detected: [],
        transcript: 'পেজে সেল কম? ৩টি সহজ পরিবর্তনেই অর্ডার বাড়ান! ১. প্রফেশনাল বায়ো ও পিন পোস্ট, ২. নিয়মিত রিলস ও ক্যারোসেল, ৩. দ্রুত ইনবক্স রিপ্লাই। ফ্রি অডিট পেতে আজই হোয়াটসঅ্যাপ করুন!',
        how_to_adapt: [
          'Duplicate this 15s structure for "Bright Mind Connect" (1 inbox for WhatsApp + Messenger) and "E-Commerce Website in 7 Days".',
        ],
        bangla_hooks: [
          'মাত্র ১৫ সেকেন্ডে আপনার পেজের রিচ দ্বিগুণ করার ৩টি গোপন টিপস!',
          'আপনার পেজ কি কাস্টমারের বিশ্বাস অর্জন করতে পারছে? চেক করুন এই ৩টি পয়েন্ট!',
        ],
        usefulness: 9,
        confidence: 'high',
        analysis_basis: 'full video',
      },
      tags: ['15s-ad', 'meta-ads', 'whatsapp-funnel', 'f-commerce', 'short-form'],
      collections: [colls.fcomm].filter(Boolean),
      resources: [
        {
          kind: 'note',
          title: 'WhatsApp Auto-Reply SLA Kit (/audit-received & /audit-sent)',
          content: 'Greeting: আসসালামু আলাইকুম! Bright Mind Digital Growth Lab-এ স্বাগতম। ফ্রি পেজ অডিটের জন্য আপনার ফেসবুক পেজের লিংকটি দিন। আমরা ২৪ ঘণ্টার মধ্যে রিপোর্ট পাঠিয়ে দেব।\n\nQuick reply /audit-sent: আপনার অডিট রিপোর্ট পাঠানো হয়েছে! রিপোর্টে দেওয়া ৩টি কাজ আগে শুরু করুন। ১৫ মিনিটের ফ্রি কলে বুঝে নিতে চান?',
          url: '',
        },
      ],
    },
    {
      url: 'https://www.skool.com/ai-growth-lab/viral-hook-prompt-pack',
      canonical_url: 'https://www.skool.com/ai-growth-lab/viral-hook-prompt-pack',
      platform: 'skool',
      content_type: 'course',
      title: 'Skool Community Drop: The "Hook → Story → Payoff" Viral Reel Architect Prompt + Drive Swipe File',
      title_source: 'user',
      author_name: 'AI Growth Lab (Skool)',
      caption: 'Shared from a YouTuber\'s Skool classroom: Complete mega-prompt that turns any dry agency service into 10 scroll-stopping Reel scripts with 3-second visual/verbal hooks, open loops, and comment-keyword payoffs.',
      thumb_path: post3Thumb,
      media_path: null,
      media_mime: null,
      media_source: null,
      archive_status: 'none',
      duration: null,
      notes: 'Grabbed from Skool classroom resources. Use this prompt whenever we script a new Reel for BMDGL or our clients.',
      category: 'Prompts',
      category_locked: 1,
      status: 'new',
      resource_status: 'received',
      comment_keyword: 'PROMPT',
      ai_status: 'done',
      ai_source: 'metadata',
      usefulness: 9,
      summary: 'A battle-tested Skool community mega-prompt and framework that converts any B2B/SME service offer into high-retention short-form scripts using a 3-layer hook (Visual + On-screen Text + Spoken Line), "But/Therefore" storytelling beats, and a comment-keyword DM payoff.',
      what_it_does: 'Lets anyone on the BMDGL team generate 10 Bangla + English Reel scripts in 60 seconds with built-in retention re-hooks every 4 seconds.',
      hook_text: 'Stop starting your videos with "Hello guys, today we will talk about..." — you lose 78% of viewers in 1.8 seconds.',
      ai: {
        title: 'Skool Drop: "Hook → Story → Payoff" Viral Reel Architect Prompt',
        summary: 'A battle-tested Skool community mega-prompt and framework that converts any B2B/SME service offer into high-retention short-form scripts using a 3-layer hook, "But/Therefore" storytelling beats, and a comment-keyword DM payoff.',
        what_it_does: 'Lets anyone on the BMDGL team generate 10 Bangla + English Reel scripts in 60 seconds with built-in retention re-hooks every 4 seconds.',
        content_type: 'course',
        category: 'Prompts',
        tags: ['skool', 'mega-prompt', 'hooks', 'storytelling', 'scriptwriting'],
        key_takeaways: [
          'Every viral short uses 3 simultaneous hooks at 0:00: Visual motion, 5-word On-Screen Banner, and a Spoken Pattern Interrupt.',
          'Replace "and then" transitions with "BUT" (conflict) and "THEREFORE" (consequence) to hold retention above 70%.',
          'Never end with "Thank you for watching"—end immediately after the final payoff line with a 5-second CTA.',
        ],
        hook: {
          text: 'Stop starting your videos with "Hello guys, today we will talk about..." — you lose 78% of viewers in 1.8 seconds.',
          type: 'Negative Mistake Call-Out + Hard Stat',
          visual: 'Red retention drop-off graph at 0:02 vs flat high retention line.',
          why_it_works: 'Exposes the #1 habit hurting small business reels and promises an immediate fix.',
        },
        story: {
          structure: '3-Layer Hook → Open Loop → Beat 1 (Problem) → BUT → Beat 2 (Discovery) → THEREFORE → Payoff Checklist → 5s Comment CTA',
          beats: [
            '0:00-0:03 - 3-Layer Hook (Visual action + 5-word headline + contrarian spoken line)',
            '0:03-0:08 - Agitate the hidden cost of the old way',
            '0:08-0:25 - Deliver 3 rapid, specific steps (visual change every 2.5s)',
            '0:25-0:30 - The Payoff + Comment keyword for the template/audit',
          ],
        },
        payoff: 'Copy-paste system prompt that outputs ready-to-shoot Bangla & English scripts with visual direction.',
        cta: 'Copy the prompt from the Vault Resources tab and run it in Gemini / Claude.',
        comment_keyword: 'PROMPT',
        tools_mentioned: [
          { name: 'Skool Classroom', purpose: 'Source community for creator SOPs & prompt packs', url: 'https://www.skool.com' },
          { name: 'CapCut / DaVinci Resolve', purpose: 'Fast jump-cut editing with dynamic Bangla captions', url: '' },
        ],
        prompts_detected: [
          'ROLE: You are a viral short-form scriptwriter for Bright Mind Digital Growth Lab (Bangladesh).\nINPUT: [Topic / Service / Client Problem]\nOUTPUT for each script:\n1. 3-Layer Hook (0-3s): Visual action + 5-word Bangla on-screen text + Spoken hook line\n2. Open Loop (3-6s): Why they must watch to the end\n3. Story Beats using BUT/THEREFORE transitions (6-28s)\n4. High-Value Payoff (28-35s): The concrete checklist or tool\n5. Comment-Keyword CTA (35-38s): Single keyword to trigger auto-DM + WhatsApp (+880 1965-059108).',
        ],
        transcript: '',
        how_to_adapt: [
          'Pin this inside the Vault Prompt Library so every writer and editor uses the same script structure before filming.',
        ],
        bangla_hooks: [
          'ভিডিওর শুরুতে "আসসালামু আলাইকুম, কেমন আছেন সবাই" বললেই ৭০% ভিউয়ার স্ক্রল করে চলে যায়!',
          'মাত্র ৩০ সেকেন্ডের রিলস থেকে কীভাবে ডিরেক্ট কাস্টমার ইনবক্সে আনবেন? ফর্মুলাটা দেখুন।',
        ],
        usefulness: 9,
        confidence: 'high',
        analysis_basis: 'caption and metadata only',
      },
      tags: ['skool', 'mega-prompt', 'hooks', 'storytelling', 'scriptwriting'],
      collections: [colls.hooks, colls.skool].filter(Boolean),
      resources: [
        {
          kind: 'prompt',
          title: 'BMDGL Viral Reel Architect Mega-Prompt (Bangla + English)',
          content: `ROLE: You are a viral short-form scriptwriter for Bright Mind Digital Growth Lab (Bangladesh), helping F-commerce and SME owners grow online.

TASK: Turn [TOPIC / SERVICE] into 3 high-retention 35-second Reel scripts in natural conversational Bangla.

FOR EACH SCRIPT PROVIDE:
1. [0-3s] 3-LAYER HOOK:
   - Visual Hook: What movement/prop/screen is shown in frame 1
   - On-Screen Text (max 6 words in bold Bangla)
   - Spoken Line (curiosity gap, mistake call-out, or bold number)
2. [3-8s] AGITATE & OPEN LOOP: Show why the viewer is losing sales/time right now and promise the fix at the end.
3. [8-28s] STORY / VALUE BEATS (use "কিন্তু / তাই" — But/Therefore transitions; new visual every 2.5s).
4. [28-34s] THE PAYOFF: The single most valuable takeaway or live before/after proof.
5. [34-38s] COMMENT CTA: Ask viewers to comment a 1-word keyword (e.g. "AUDIT", "PROMPT", "CONNECT") to get our free checklist/audit on WhatsApp (+880 1965-059108).`,
          url: '',
        },
      ],
    },
  ];

  tx(() => {
    const insItem = db.prepare(`INSERT INTO items(
      url, canonical_url, platform, content_type, title, title_source, author_name, caption,
      thumb_path, media_path, media_mime, media_source, archive_status, duration,
      notes, category, category_locked, status, resource_status, comment_keyword,
      ai_status, ai_source, ai_json, summary, what_it_does, hook_text, usefulness, shared_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insTag = db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES (?, ?)');
    const insRes = db.prepare('INSERT INTO resources(item_id, kind, title, content, url, created_by) VALUES (?, ?, ?, ?, ?, ?)');
    const insCol = db.prepare('INSERT OR IGNORE INTO collection_items(collection_id, item_id) VALUES (?, ?)');

    const sharers = [adminId, sharafatId, editorId, adminId];
    seedItems.forEach((s, idx) => {
      const uid = sharers[idx % sharers.length] || adminId;
      const r = insItem.run(
        s.url, s.canonical_url, s.platform, s.content_type, s.title, s.title_source, s.author_name, s.caption,
        s.thumb_path || null, s.media_path || null, s.media_mime || null, s.media_source || null, s.archive_status || 'none', s.duration || null,
        s.notes, s.category, s.category_locked, s.status, s.resource_status, s.comment_keyword || null,
        s.ai_status, s.ai_source, JSON.stringify(s.ai), s.summary, s.what_it_does, s.hook_text, s.usefulness, uid
      );
      const itemId = Number(r.lastInsertRowid);
      for (const t of s.tags) insTag.run(itemId, t);
      for (const res of s.resources) insRes.run(itemId, res.kind, res.title, res.content, res.url, uid);
      for (const cid of s.collections) insCol.run(cid, itemId);
    });
  });
  console.log('[seed] Populated initial BMDGL Content Vault swipe file items & collections.');
}
