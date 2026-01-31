import { Plugin, Notice, requestUrl, TFile, normalizePath } from "obsidian";
import { LastFmSettings, DEFAULT_SETTINGS, LastFmSettingTab } from "./settings";

interface LastFmTrack {
  name: string;
  artist: { "#text": string };
  album?: { "#text": string };
  date?: { uts: string };
  image?: Array<{ "#text": string; size: string }>;
}

interface LastFmRecentTracksResponse {
  recenttracks?: {
    track?: LastFmTrack | LastFmTrack[];
    "@attr"?: { page?: string; totalPages?: string; total?: string };
  };
  error?: number;
  message?: string;
}

interface TrackGroup {
  count: number;
  latestIso: string;
  latestTs: number;
  firstIso: string;
  firstTs: number;
  album: string;
  coverUrl: string;
  artist: string;
  name: string;
  fileName: string;
}
export default class LastFmMusicLibraryPlugin extends Plugin {
  settings!: LastFmSettings;
  statusBarItem: HTMLElement | null = null;
  private autoSyncIntervalId: number | null = null;
  private readonly AUTO_SYNC_INTERVAL_MINUTES = 30;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("headphones", "Sync Last.fm", () => void this.syncTracks());

    this.addCommand({
      id: "lastfm-sync",
      name: "Sync recent tracks",
      callback: () => void this.syncTracks(),
    });

    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar("Ready");

    this.addSettingTab(new LastFmSettingTab(this.app, this));

    if (this.settings.autoSyncEnabled) {
      this.enableAutoSync();
    }
  }

  public enableAutoSync() {
    if (this.autoSyncIntervalId !== null) return;

    const ms = this.AUTO_SYNC_INTERVAL_MINUTES * 60 * 1000;

    this.autoSyncIntervalId = window.setInterval(async () => {
      console.debug("[auto] Syncing every 30 minutes");
      await this.syncTracks();
    }, ms);

    this.registerInterval(this.autoSyncIntervalId);
    console.debug(`Auto-sync started: every ${this.AUTO_SYNC_INTERVAL_MINUTES} minutes`);
    this.updateStatusBar("Auto ON");
  }

  public disableAutoSync() {
    if (this.autoSyncIntervalId === null) return;

    window.clearInterval(this.autoSyncIntervalId);
    this.autoSyncIntervalId = null;
    console.debug("Auto-sync stopped");
    this.updateStatusBar("Auto OFF");
  }

  updateStatusBar(message: string) {
    if (this.statusBarItem) {
      const auto = this.settings.autoSyncEnabled ? " | Auto ON" : " | Auto OFF";
      this.statusBarItem.setText(`Last.fm: ${message}${auto}`);
    }
  }

  async syncTracks(): Promise<void> {
    const { apiKey, username, folder } = this.settings;

    if (!apiKey || !username) {
      new Notice("Please set API key and username in settings");
      this.updateStatusBar("Error: missing API key or username");
      return;
    }

    const folderPath = normalizePath(folder);
    await this.app.vault.createFolder(folderPath).catch(() => {});

    let historyFolder: string;

    if (this.settings.historyFolderPath.trim()) {
      historyFolder = normalizePath(this.settings.historyFolderPath);
      const folderExists = this.app.vault.getAbstractFileByPath(historyFolder);
      if (!folderExists) {
        new Notice(`History folder "${historyFolder}" not found. Create it manually.`);
        this.updateStatusBar("History folder missing");
        return;
      }
    } else {
      historyFolder = normalizePath(`${folder}/History`);
      await this.app.vault.createFolder(historyFolder).catch(() => {});
      this.settings.historyFolderPath = historyFolder;
      await this.saveSettings();
    }

    let lastFetchedTimestamp = 0;
    let fromTimestamp = 0;
    let found = false;

    const currentYear = new Date().getFullYear();

    for (let year = currentYear; year >= currentYear - 20; year--) {
      const fileName = `History-${year}.md`;
      const path = normalizePath(`${historyFolder}/${fileName}`);
      const file = this.app.vault.getAbstractFileByPath(path);

      if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        for (const line of lines) {
          const match = line.match(/^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
          if (match?.[1]) {
            const ts = this.localISOToTimestamp(match[1]);
            if (ts) {
              lastFetchedTimestamp = ts;
              fromTimestamp = ts + 1;
              this.updateStatusBar(`Syncing after ${match[1]} (${fileName})`);
              console.debug(`Latest entry found in ${fileName}: ${match[1]} → from ${fromTimestamp}`);
              found = true;
              break;
            }
          }
        }
        if (found) break;
      }
    }

    if (!found) {
      this.updateStatusBar("No history — fetching last 200 tracks");
      console.debug("No history files — fetching recent without 'from', limited to page 1");
    }

    const allNewTracks: LastFmTrack[] = [];
    const limit = 200;
    let page = 1;
    let totalPages = 1;
    let attempts = 0;
    const maxAttempts = 3;

    fetchLoop: while (page <= totalPages && attempts < maxAttempts) {
      const params = new URLSearchParams({
        method: "user.getrecenttracks",
        user: username,
        api_key: apiKey,
        format: "json",
        limit: limit.toString(),
        page: page.toString(),
      });

      if (found) {
        params.append("from", fromTimestamp.toString());
      }

      const url = `https://ws.audioscrobbler.com/2.0/?${params}`;
      console.debug(`Sending request (page ${page}): ${url}`);

      try {
        const resp = await requestUrl({ url, method: "GET" });
        const data = resp.json as LastFmRecentTracksResponse;

        if (data.error) throw new Error(data.message || "API error");

        if (page === 1 && data.recenttracks?.["@attr"]?.totalPages) {
          totalPages = Number(data.recenttracks["@attr"].totalPages);

          if (!found) {
            totalPages = 1;
            console.debug("No history — limiting to page 1 (last 200 tracks)");
          }
        }

        let tracks = data.recenttracks?.track ?? [];
        if (!Array.isArray(tracks)) tracks = [tracks];
        if (tracks.length === 0) break;

        allNewTracks.push(...tracks);
        page++;

        if (page <= totalPages) await new Promise(r => setTimeout(r, 2000));
      } catch (err: any) {
        console.error("Sync attempt failed:", err);
        if ((err.status === 500 || err.status === 429) && attempts < maxAttempts - 1) {
          attempts++;
          const delay = err.status === 429 ? 30000 : 5000;
          console.warn(`Last.fm error ${err.status} — retry ${attempts}/${maxAttempts} in ${delay/1000}s...`);
          this.updateStatusBar(`Last.fm error ${err.status} — retrying...`);
          await new Promise(r => setTimeout(r, delay));
          continue fetchLoop;
        }
        new Notice(`Sync failed: Last.fm returned ${err.status || "unknown error"}. Try again later.`);
        this.updateStatusBar("Sync failed");
        return;
      }
    }

    if (!allNewTracks.length) {
      new Notice("No new tracks");
      this.updateStatusBar("No new tracks");
      return;
    }

    const trulyNewTracks = allNewTracks.filter(t => {
      const ts = t.date?.uts ? Number(t.date.uts) : 0;
      return ts > lastFetchedTimestamp;
    });

    if (trulyNewTracks.length === 0) {
      new Notice("All fetched tracks already recorded");
      this.updateStatusBar("No new tracks");
      console.debug(`Fetched ${allNewTracks.length}, new after filter: 0`);
      return;
    }

    console.debug(`Fetched ${allNewTracks.length}, filtered to ${trulyNewTracks.length} new`);

    const trackGroups = new Map<string, TrackGroup>();
    const historyPlays: { fileName: string; dateIso: string; ts: number }[] = [];

    for (const t of trulyNewTracks) {
      const artist = t.artist?.["#text"]?.trim() || "Unknown";
      const name = t.name?.trim() || "Unknown";
      const key = `${artist}|${name}`;
      const ts = t.date?.uts ? Number(t.date.uts) : Math.floor(Date.now() / 1000);
      const iso = this.timestampToLocalISO(ts);
      const album = t.album?.["#text"]?.trim() || "";
      const coverUrl = this.extractBestCover(t.image);

      const safeArtist = this.sanitizeFileName(artist);
      const safeName = this.sanitizeFileName(name);
      const fileName = `${safeArtist} - ${safeName}.md`;

      historyPlays.push({ fileName, dateIso: iso, ts });

      let group = trackGroups.get(key);
      if (!group) {
        group = {
          count: 0,
          latestIso: iso,
          latestTs: ts,
          firstIso: iso,
          firstTs: ts,
          album,
          coverUrl,
          artist,
          name,
          fileName,
        };
        trackGroups.set(key, group);
      }

      group.count++;
      if (ts > group.latestTs) {
        group.latestIso = iso;
        group.latestTs = ts;
        group.album = album;
        group.coverUrl = coverUrl;
      }
      if (ts < group.firstTs) {
        group.firstIso = iso;
        group.firstTs = ts;
      }
    }

    historyPlays.sort((a, b) => a.ts - b.ts);

    let created = 0;
    let updated = 0;

    for (const group of trackGroups.values()) {
      const path = normalizePath(`${folder}/${group.fileName}`);
      const file = this.app.vault.getAbstractFileByPath(path);
      const lastfmUrl = this.buildLastFmUrl(group.artist, group.name);

      if (!(file instanceof TFile)) {
        const content = this.buildNewTrackContent(group, lastfmUrl);
        await this.app.vault.create(path, content);
        created++;
      } else {
        let content = await this.app.vault.read(file);
        content = this.updateTrackContent(content, group.count, group.latestIso);
        await this.app.vault.modify(file, content);
        updated++;
      }
    }

    for (const play of historyPlays) {
      const linkName = play.fileName.replace(/\.md$/, "");
      await this.appendToHistory(linkName, play.dateIso);
    }

    const msg = `Fetched ${allNewTracks.length} • New ${trulyNewTracks.length} • Created ${created} • Updated ${updated}`;
    this.updateStatusBar(msg);
    new Notice(msg);
  }

  async appendToHistory(name: string, iso: string): Promise<void> {
    const year = iso.slice(0, 4);
    const fileName = `History-${year}.md`;
    const folder = this.settings.historyFolderPath.trim()
      ? normalizePath(this.settings.historyFolderPath)
      : normalizePath(`${this.settings.folder}/History`);

    const path = normalizePath(`${folder}/${fileName}`);
    const entry = `- ${iso} — [[${name}]]`;

    let content = "# History\n\n";

    try {
      content = await this.app.vault.adapter.read(path);
    } catch {
      await this.app.vault.createFolder(folder).catch(() => {});
    }

    if (content.includes(entry)) return;

    if (!content.includes("# History")) {
      content = "# History\n\n" + content.trimStart();
    }

    const lines = content.split("\n");
    let insertAt = lines.findIndex(l => l.trim() === "# History") + 1;
    while (insertAt < lines.length && lines[insertAt]?.trim() === "") {
      insertAt++;
    }

    lines.splice(insertAt, 0, entry);

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      await this.app.vault.create(path, lines.join("\n"));
    } else {
      await this.app.vault.modify(file as TFile, lines.join("\n"));
    }
  }

  private extractBestCover(images?: LastFmTrack["image"]): string {
    if (!images?.length) return "";
    const img =
      images.find(i => i.size === "extralarge") ||
      images.find(i => i.size === "large") ||
      images[0];
    return img?.["#text"]?.trim() || "";
  }

  private buildLastFmUrl(artist: string, track: string): string {
    const a = encodeURIComponent(artist).replace(/%20/g, "+");
    const t = encodeURIComponent(track).replace(/%20/g, "+");
    return `https://www.last.fm/music/${a}/_/${t}`;
  }

  private buildNewTrackContent(g: TrackGroup, url: string): string {
    return `---
track: ${g.name}
artist: ${g.artist}
album: ${g.album || "—"}
tags: [song]
lastfm_url: ${url}
play_count: "${g.count}"
first_listened_at: ${g.firstIso}
last_listened_at: ${g.latestIso}
cover_url: ${g.coverUrl}
---
![](${g.coverUrl})
[Last.fm → ${g.name}](${url})

`;
  }

  private updateTrackContent(content: string, newPlays: number, latestIso: string): string {
    const countMatch = content.match(/play_count:\s*"?(\d+)"?/);
    let count = countMatch ? Number(countMatch[1]) + newPlays : newPlays;
    content = content.replace(/play_count:\s*"?\d+"?/, `play_count: "${count}"`);
    content = content.replace(/last_listened_at:\s*.+/, `last_listened_at: ${latestIso}`);
    return content;
  }

  private timestampToLocalISO(ts: number): string {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private localISOToTimestamp(iso: string): number | null {
    const dt = new Date(iso);
    return isNaN(dt.getTime()) ? null : Math.floor(dt.getTime() / 1000);
  }

  private sanitizeFileName(str: string): string {
    return str.replace(/[*"\\/<>|:?]/g, "-").trim();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    if (this.statusBarItem) this.statusBarItem.remove();
  }
}