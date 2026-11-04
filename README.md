# BMDGL Content Vault

**Bright Mind Digital Growth Lab (BMDGL)** — Internal Team Content Repository, Inline Video/Reel Player, Prompt & Tool Tracker, and Hook → Story → Payoff Breakdown Engine.

---

## ✨ Key Features

1. **Watch Content Directly Inside the Repository**
   - Supports **Facebook Reels/Videos/Posts**, **Instagram Reels/Posts**, **YouTube Videos & Shorts**, **TikTok**, **X/Twitter**, **LinkedIn**, **Threads**, **Google Drive Folders/Docs**, **Vimeo**, **Loom**, **Skool**, and direct **MP4/image/PDF uploads**.
   - Dual-mode Theater Player: play the **Instant Offline MP4 Copy** (auto-archived via `yt-dlp` or uploaded) or switch to the **Live Platform Embed**.
2. **Prompts, Tools, Skool Drops & "Comment KEYWORD" Tracker**
   - Attach multiple **Prompts**, **Tools/Links**, **Google Drive folders**, or **Skool classroom notes** to any shared item with one-click copy.
   - Track reels that say *"Comment 'PROMPT' / 'SOUND' and I'll DM you the link"* with a dedicated workflow status (`Need to comment / DM` → `Requested` → `Received`) and a sidebar filter so no promised resource is ever forgotten.
3. **Accurate Summary & Hook → Story → Payoff Breakdown**
   - Every item stores a clear **Summary**, **What It Can Do for BMDGL**, **Scroll-Stopping Hook Analysis** (0–3s spoken/on-screen text, visual hook, why it works), **Story Structure & Beats**, **Payoff & CTA**, and **Bangla Hook Adaptations**.
4. **Organized & Easy to Use**
   - **Specialized Libraries**: **Prompt Library**, **Hook & Payoff Lab**, **Tools & Drive Links**, and **Team & Export**.
   - **Collections & Workflow States**: `New` → `Testing in Lab` → `Used in Our Content` → `Archived`.
   - **Instant Search & Shortcuts**: Press `/` to search across titles, hooks, prompts, Bangla text, and tags; press `N` to share content; toggle Dark/Light mode or Grid/List layout.
   - **CSV & JSON Export**: One-click CSV export for Excel/Google Sheets and full JSON backup.

---

## 🚀 Quick Start

**Requirements:** Node.js `>= 22.13.0` (uses the built-in `node:sqlite` engine — zero native compilation needed). Optional: `yt-dlp` and `ffmpeg` on `PATH` for offline video archiving and thumbnail extraction.

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.
