# Last.fm Music Library

Obsidian plugin that imports your recent scrobbles from Last.fm and creates/updates individual notes for each track with play count, first/last listen time, album cover and link to Last.fm page.

Also maintains a chronological history file.

## Features

- Automatic or manual sync of recent tracks
- Unique markdown notes per track
- Play count tracking
- First/last listened timestamps (local time)
- Album cover embeds
- History.md with chronological entries (newest on top)

## Installation

Available in Obsidian Community Plugins soon.

## Manual install

1. Download latest release
2. Copy `main.js`, `manifest.json` to `<vault>/.obsidian/plugins/lastfm-music-library/`
3. Enable in Settings → Community plugins

## Settings

- Last.fm API key
- Username
- Notes folder
- History file path (auto-generated if empty)
- Enable auto-sync (every 30 minutes)

## Privacy

Plugin only makes requests to Last.fm API with your API key and username. No data is sent anywhere else.

## License

MIT License — see the [LICENSE](LICENSE) file for details.