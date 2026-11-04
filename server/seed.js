import { db, ensureCategory } from './db.js';
import { createUser } from './auth.js';
import { config } from './config.js';

export const TEAM_ACCOUNTS = [
  { name: 'Pritom',   email: 'pritom@brightmind.com',   password: 'password123', role: 'admin' },
  { name: 'Sharafat', email: 'sharafat@brightmind.com', password: 'password123', role: 'member' },
  { name: 'Minhaj',   email: 'minhaj@brightmind.com',   password: 'password123', role: 'member' },
  { name: 'Saiful',   email: 'saiful@brightmind.com',   password: 'password123', role: 'member' },
  { name: 'Rafi',     email: 'rafi@brightmind.com',     password: 'password123', role: 'member' },
  { name: 'Tanvir',   email: 'tanvir@brightmind.com',   password: 'password123', role: 'member' },
  { name: 'Akib',     email: 'akib@brightmind.com',     password: 'password123', role: 'member' },
];

const INITIAL_ITEMS = [
  {
    id: 5,
    url: 'https://www.facebook.com/reel/2128832964507623',
    canonical_url: 'https://www.facebook.com/reel/2128832964507623',
    platform: 'facebook',
    content_type: 'reel',
    title: 'Claude AI Agent Reach — Connect Claude to All Your Apps',
    title_source: 'meta',
    category_locked: 0,
    duration: 53.019,
    author_name: 'Ben Kimball',
    caption: 'Wait Until The End! 🤯 Claude AI Can FINALLY Access ALL Your Apps With This INSANE GitHub Repo! Connect Claude to your favorite apps and automate everything! #ClaudeAI #Claude #AITools #GitHub #GitHubRepo AI Automation AIApps ClaudeCode TechTok ArtificialIntelligence Productivity AITutorial',
    thumb_path: 'thumbs/item-5-1793798417625.jpg',
    media_path: 'media/item-5.mp4',
    media_mime: 'video/mp4',
    media_source: 'archive',
    category: 'AI Tools',
    status: 'new',
    resource_status: 'received',
    comment_keyword: 'SKILL',
    ai_status: 'done',
    ai_source: 'gemini-agent',
    summary: 'This content introduces Agent Reach, an open-source GitHub repository that enables Claude AI to connect with and automate tasks across various social media platforms and the web. It demonstrates how Claude can search, read, and interact with platforms like YouTube, X, Instagram, TikTok, and Reddit.',
    what_it_does: "The team can use this tool to expand Claude AI's capabilities, allowing it to perform research and automate content-related tasks across multiple online platforms. Implement Agent Reach to integrate Claude into workflows requiring data retrieval or interaction with social media and web content.",
    hook_text: 'Claude AI Can FINALLY Access ALL Your Apps With This GitHub Repo',
    usefulness: 9,
    archive_status: 'done',
    created_at: '2026-11-04 13:20:14',
    updated_at: '2026-11-04 13:20:20',
    tags: ['claude', 'ai agent', 'github', 'agent reach'],
    resources: [
      {
        kind: 'tool',
        title: 'Agent Reach — GitHub Repository',
        content: 'Open-source CLI & agent skill (Panniantong/agent-reach) that lets Claude AI search, read, and automate across YouTube, X, Instagram, TikTok, Reddit, and the web.',
        url: 'https://github.com/Panniantong/agent-reach',
      },
    ],
  },
  {
    id: 6,
    url: 'https://www.facebook.com/reel/1127582653330179',
    canonical_url: 'https://www.facebook.com/reel/1127582653330179',
    platform: 'facebook',
    content_type: 'reel',
    title: 'YouTube Agent Skill — AI Agent Tool for YouTube Automation',
    title_source: 'ai',
    category_locked: 0,
    duration: 66.8,
    author_name: 'ArjunContents',
    caption: 'YouTube Agent Skill\nFollow @arjuncontents for AI and tech updates.\n#AITools #Tech #ArjunContents',
    thumb_path: 'thumbs/item-6-1793802126267.jpg',
    media_path: 'media/item-6.mp4',
    media_mime: 'video/mp4',
    media_source: 'archive',
    category: 'Automation',
    status: 'new',
    resource_status: 'none',
    comment_keyword: null,
    ai_status: 'done',
    ai_source: 'gemini-agent',
    summary: 'This is an open-source AI agent skill designed to automatically extract YouTube transcripts, video metadata, and detailed channel insights. It streamlines the process of gathering data from YouTube videos for research or content analysis.',
    what_it_does: 'The team can integrate this skill into their AI agents to automate competitor research and content scraping. Use the GitHub repository to deploy a system that pulls transcripts and metadata without manual effort.',
    hook_text: 'YouTube Agent Skill — Automate YouTube Research with AI Agents',
    usefulness: 9,
    archive_status: 'done',
    created_at: '2026-11-04 14:22:02',
    updated_at: '2026-11-04 14:22:09',
    tags: ['aitools', 'tech', 'arjuncontents', 'facebook', 'reel', 'ai', 'youtube automation', 'ai agent', 'github', 'youtube agent skill'],
    resources: [
      {
        kind: 'tool',
        title: 'YouTube Agent Skill — GitHub Repository',
        content: 'Open-source AI agent skill (Jakeschincariol/youtube-agent-skill) for extracting YouTube transcripts, video metadata, and channel insights automatically.',
        url: 'https://github.com/Jakeschincariol/youtube-agent-skill',
      },
    ],
  },
  {
    id: 7,
    url: 'https://www.youtube.com/watch?v=e2Fykz51Nxg',
    canonical_url: 'https://www.youtube.com/watch?v=e2Fykz51Nxg',
    platform: 'youtube',
    content_type: 'video',
    title: 'Claude Edited This Netflix-Level Documentary (Copy Me)',
    title_source: 'meta',
    category_locked: 1,
    duration: null,
    author_name: 'Zane Hoyer',
    author_url: 'https://www.youtube.com/@zanehoyer',
    caption: "Link to Abacus AI Agent: https://agent.abacus.ai/zan\nLink to Prompt: https://docs.google.com/document/d/19Bz2tmn57b0unK2kUGFOsIAzjWWNxhnn_TuZqA-XZIk/edit?usp=sharing\n\nClaude Opus 5.5 edited this Netflix-level documentary from just my audio, a few reference images and a prompt. Here's the exact AI video editing workflow so you can copy it and make cinematic documentary videos for YouTube, Instagram and TikTok, even if you're a beginner.\n\nIn this video:\n• Finding references on Pinterest for 3D documentary, cinematic newspaper animations and documentary map animations\n• Prompting Claude Opus 5.5 to build motion graphics with code, no AI video generator\n• What to tell the AI when your first version looks like a PowerPoint\n• AI sound design with GPT 6 Astra and X High mode\n• Making an AI voiceover from your script and layering motion design on top",
    thumb_path: 'thumbs/item-7-1793804165765.jpg',
    media_path: config.isVercel ? null : 'media/item-7.mp4',
    media_mime: config.isVercel ? null : 'video/mp4',
    media_source: config.isVercel ? null : 'archive',
    category: 'Motion Graphics & Documentary',
    status: 'new',
    resource_status: 'none',
    comment_keyword: null,
    ai_status: 'done',
    ai_source: 'gemini-agent',
    summary: 'This video details a workflow for creating cinematic, Netflix-level documentary videos using Claude Opus 5.5, starting from audio and reference images. It showcases how to prompt Claude to build motion graphics with code, integrate AI sound design, and layer AI voiceovers.',
    what_it_does: 'Use this workflow and the provided prompt to generate professional, code-driven motion graphic documentaries from audio and visual inputs. Apply the techniques for AI sound design and voiceover integration to create cinematic content without relying on generic AI video generators.',
    hook_text: 'Claude Edited This Netflix-Level Documentary (Copy Me)',
    usefulness: 9,
    archive_status: config.isVercel ? 'none' : 'done',
    created_at: '2026-11-04 14:56:04',
    updated_at: '2026-11-04 15:16:53',
    tags: ['youtube', 'video', 'motion graphics', 'documentary', 'claude', '3d animation', 'html canvas'],
    resources: [
      {
        kind: 'prompt',
        title: 'Continuous Flowing Claude Documentary Prompt (Google Doc)',
        content: `I want a cinematic motion video built entirely from code. No AI video generators and no stock footage. Every frame should be drawn with code (HTML canvas is fine) and rendered to an MP4.\n\n\nINPUTS (attached):\n- Script / voiceover: [attach audio file] — line timings: [paste each line with its start time, or tell Claude to work them out from the audio]\n- Photos of the real people/places/objects: [attached]\n- Style references: [attached — these show the look I want, match their feel]\n- Format: [e.g. 21:9, 3840x1646, 30fps] — length must match the voiceover exactly.\n\n\nTHE STYLE:\n- The whole video is ONE continuous camera move over one big world: a map, a desk, a board, whatever fits the story. Nothing cuts and no slides change. The camera glides, pushes in on details, pulls back to travel, and dives in again.\n- Motion must feel smooth and filmed. Every start and stop eases in and out. The camera never stops dead: during holds it keeps drifting slowly in the direction it's about to go. Add subtle handheld movement, motion blur on fast moves, film grain, a soft glow and a vignette.\n- Real photos and documents drop onto the world as physical objects (prints, papers, clippings), placed where the story happens.\n\n\nSTORYTELLING AND READABILITY RULES (most important):\n1. One idea per line of narration. Each line gets ONE hero on screen (a photo, a word or a document) and everything else dims back.\n2. Every phrase appears on screen once, never repeated. If the narrator says it, either show it on a real document or type it on screen, never both.\n3. No filler text. Body copy on documents should be soft grey lines that read as paper, not words people try to read.\n4. Big, readable type: hero words very large, labels never tiny. If someone can't read it on a phone in one second, it's too small or there's too much.\n5. Less is more. Leave out decorative clutter (random tape, stamps, memos, extra labels) that isn't part of the story.\n6. Visual moments land exactly on the spoken word: a circle drawn as the word is said, a stamp slamming on the beat.\n\n\nPROCESS:\n- Before you build, write a beat table: time → narration → the one hero on screen → any on-screen text. Show it to me and ask me anything that's unclear.\n- Take your time. Quality matters more than speed. Prioritise design, smooth movement and clarity over adding more stuff.\n- Before the final render, check your own work: look at stills from every beat and frame sequences of the camera moves. Fix anything that's cluttered, hard to read, overlapping, or that jerks or stops abruptly.\n- Deliver the final MP4 with my voiceover synced, in the exact format above.`,
        url: 'https://docs.google.com/document/d/19Bz2tmn57b0unK2kUGFOsIAzjWWNxhnn_TuZqA-XZIk/edit?pli=1&tab=t.0',
      },
    ],
  },
];

export function seedIfEmpty() {
  if (process.env.NO_SEED === '1') return;

  // 1. Ensure all 7 team accounts exist
  for (const acc of TEAM_ACCOUNTS) {
    const row = db.prepare('SELECT id FROM users WHERE email = ?').get(acc.email);
    if (!row) createUser(acc);
  }

  // 2. Ensure default team collections exist
  const collCount = db.prepare('SELECT COUNT(*) AS n FROM collections').get().n;
  if (collCount === 0) {
    const insC = db.prepare('INSERT INTO collections(name, description, emoji) VALUES (?, ?, ?)');
    insC.run('AI Tools & Automation', 'Useful AI tools, GitHub repos, and workflow automations', '⚡');
    insC.run('Prompts & Templates', 'Copy-paste prompts, system instructions, and templates', '📋');
    insC.run('Growth & Content Ideas', 'High-performing Reels, Shorts, and creative references', '🎬');
    insC.run('Skool & Community Drops', 'Drive folders, lead magnets, and community resources', '📦');
  }

  // 3. Ensure Pritom's 3 uploaded items & resources exist (so Vercel always has them out-of-the-box)
  const itemCount = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  if (itemCount === 0 && process.env.DISABLE_JOBS !== '1') {
    const pritom = db.prepare("SELECT id FROM users WHERE email = 'pritom@brightmind.com'").get();
    const pritomId = pritom ? pritom.id : 1;

    ensureCategory('Motion Graphics & Documentary', 'user');
    ensureCategory('AI Tools', 'system');
    ensureCategory('Automation', 'system');

    const insItem = db.prepare(`
      INSERT INTO items(
        id, url, canonical_url, platform, content_type, title, title_source, category_locked,
        duration, author_name, author_url, caption, thumb_path, media_path, media_mime, media_source,
        category, status, resource_status, comment_keyword, ai_status, ai_source, ai_json,
        summary, what_it_does, hook_text, usefulness, archive_status, shared_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    const insRes = db.prepare('INSERT INTO resources(item_id, kind, title, content, url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insTag = db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES (?, ?)');

    for (const it of INITIAL_ITEMS) {
      const aiObj = {
        title: it.title,
        summary: it.summary,
        what_it_does: it.what_it_does,
        content_type: it.content_type,
        category: it.category,
        created_new_category: false,
        tags: it.tags,
        key_takeaways: [],
        hook: { text: it.hook_text || '', type: '', visual: '', why_it_works: '' },
        story: { structure: '', beats: [] },
        payoff: '',
        cta: '',
        comment_keyword: it.comment_keyword || '',
        tools_mentioned: [],
        prompts_detected: [],
        transcript: '',
        how_to_adapt: [],
        bangla_hooks: [],
        usefulness: it.usefulness,
        confidence: 'high',
        analysis_basis: 'caption and metadata',
      };

      insItem.run(
        it.id, it.url, it.canonical_url, it.platform, it.content_type, it.title, it.title_source, it.category_locked,
        it.duration, it.author_name || null, it.author_url || null, it.caption || null, it.thumb_path, it.media_path, it.media_mime, it.media_source,
        it.category, it.status, it.resource_status, it.comment_keyword, it.ai_status, it.ai_source, JSON.stringify(aiObj),
        it.summary, it.what_it_does, it.hook_text, it.usefulness, it.archive_status, pritomId, it.created_at, it.updated_at
      );

      for (const r of it.resources) {
        insRes.run(it.id, r.kind, r.title, r.content, r.url, pritomId, it.created_at);
      }
      for (const t of it.tags) {
        insTag.run(it.id, t);
      }
    }
  }

  // 4. Ensure initial Vault Agent insights for Pritom exist
  const insightCount = db.prepare('SELECT COUNT(*) AS n FROM agent_insights').get().n;
  if (insightCount === 0) {
    db.prepare('INSERT INTO agent_insights(summary, learned_preferences_json, recommendations_json) VALUES (?, ?, ?)').run(
      "Pritom, your Vault Agent is actively learning your content preferences — enforcing clear, actionable English descriptions and precise categorization for advanced visual and AI agent workflows.",
      JSON.stringify([
        "All output must be in clear, concise English only, without any Bangla.",
        "Descriptions must be complete and self-contained, never truncated with ellipses.",
        "Code-driven 3D animations, HTML canvas visuals, After Effects, and documentary motion graphics are specifically categorized under 'Motion Graphics & Documentary', distinct from generic 'Video Editing'.",
        "Content descriptions (summary) are 1-2 crisp sentences explaining what the content/tool is, and 'what_it_does' is 1-2 actionable sentences on how the team should use it."
      ]),
      JSON.stringify([
        {
          title: "Expand AI-Driven Motion Graphics & Visuals Content",
          category: "Content Gap",
          why: "The team's favorite content highlights a strong interest in AI-powered cinematic visuals and motion graphics.",
          action: "Actively source and add more advanced tutorials, workflows, and tools focused on using AI for motion graphics, 3D rendering, and visual effects."
        },
        {
          title: "Create 'AI Agents & Workflow Automation' Category",
          category: "New Category Opportunity",
          why: "Two out of three current items are directly related to AI agents and connecting AI to external platforms.",
          action: "Keep dropping AI agent tools and prompts in the Quick Drop bar — the Vault Agent will automatically group and tag them for instant search."
        },
        {
          title: "Introduce AI Model/Tool Specific Tagging",
          category: "Repository Feature",
          why: "Many tools and workflows are specific to certain models (e.g., Claude) or platforms, making discovery faster with explicit tags.",
          action: "Use the search bar's live keyword suggestions (#Claude, #Motion Graphics, #AI Agent) to filter workflows in one click."
        }
      ])
    );
  }
}
