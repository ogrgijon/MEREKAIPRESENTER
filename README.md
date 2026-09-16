# Merekai Presenter

[English](README.md) | [Español](README.es.md)

**Ever arrive at a venue, start a presentation, and see the desktop or taskbar
on screen, even in the middle of the event?**

That is why we created Merekai Presenter: a fullscreen player that keeps your
photos and videos in the spotlight while you control the presentation without
accidentally exposing the desktop.

Turn a folder of media into a polished, controllable presentation. Merekai
Presenter is a local-first photo and video presenter for galleries, events,
exhibitions, showrooms, classrooms, studios, and digital signage. Pick a
folder, arrange the story, add an overlay, and let the player run without
sending your media to a cloud service.

![Merekai Presenter](iconoMerekaiGallery.png)

## Why Merekai Presenter?

Presentations often begin as a folder of files and end up needing a little
more control: a deliberate order, a readable title, an occasional announcement,
or a way to pause and jump to a specific item. Merekai Presenter keeps those
controls close to the screen while keeping the media and settings on the local
machine.

## Highlights

- **Fullscreen playback** for common image and video formats
- **Folder-aware ordering** so a large collection can be organized by folders
	or by individual files
- **Live playback control** with play, pause, previous, next, speed, and direct
	selection from the generated queue
- **Presentation presets** for quickly switching between common playback styles
- **Flexible overlays** for titles, captions, labels, shapes, images, and custom
	CSS styling
- **Dynamic overlay text** with tokens such as filename and parent folder
- **Scheduled inserts and alerts** for clips or announcements at chosen points
- **Local-first operation** with settings stored in a local SQLite database

## Typical uses

### Gallery and exhibition displays

Point the app at an image collection, choose a comfortable slide duration, and
leave the player running in fullscreen. Use folder ordering when each folder is
a room, artist, collection, or chapter.

### Events and presentations

Build a predictable media order, add a title or sponsor overlay, and use the
playlist controls to move through the presentation during a live event.

### Showrooms and digital signage

Use shuffle or repeat-friendly playback for a hands-off display. Scheduled
insert clips can bring in announcements or promotional media without rebuilding
the main collection.

### Teaching and studio review

Keep media on the workstation, use the queue to jump between files, and adjust
fit mode, volume, and playback speed while reviewing material with a group.

## Main options

### Playback

- Slide duration for images
- Video volume
- Play, pause, previous, and next
- Faster or slower playback
- Fit mode for choosing how media fills the screen
- Sequential or shuffled playback

### Media order

- Choose a media folder with the native folder picker
- A default library is created automatically: `Pictures/MerekaiGallery` on Windows and Linux, or `media` in the home directory on Raspberry Pi
- View folders only, or folders with their files
- Reorder top-level folders by drag and drop
- Reorder individual files by drag and drop
- Reset to the discovered default order

### Playlist and inserts

- See the current item, progress, duration, and upcoming queue
- Select any queue item to play it immediately
- Configure insert media to play every N items, after a folder, or on a loop
- Choose whether an insert applies to the top-level folder or an exact folder
- Hide overlays during an insert when a clean full-screen clip is needed
- Trigger insert and alert media on demand

### Overlay designer

- Add text, bar, square, circle, image, or drawing layers
- Position layers left, center, or right and top, center, or bottom
- Adjust offsets, size, opacity, rotation, colors, borders, and radius
- Configure typography, shadows, and advanced CSS
- Use `filename` and `parentFolder` tokens in dynamic text
- Preview at selectable resolutions and save changes automatically or manually

## How it works

1. Start the local server.
2. Open the control panel and choose a media folder.
3. Configure playback settings or apply a preset.
4. Arrange folders or files in **Media order**.
5. Add overlays or scheduled inserts when the presentation needs them.
6. Open the fullscreen player and control playback from the panel.

The control panel and player are served by one Node.js process. The browser UI
communicates with the local server over HTTP, while settings are persisted in a
SQLite database outside the repository.

## Requirements

- Node.js 20 or newer
- npm
- A browser for the control panel

## Install

Install dependencies for the server and the Angular control panel:

```bash
npm install
npm --prefix control-panel install
```

## Build and run

Build all project parts, then start the local server:

```bash
npm run build
npm start
```

The control panel is available at `http://127.0.0.1:3131`. Use it to choose a
media folder and configure playback. The player is served at
`http://127.0.0.1:3131/player/`.

For development, `npm run dev` builds the project and starts the server. The
main build commands are:

```bash
npm run build:server
npm run build:renderer
npm run build:panel
```

## Raspberry Pi player

To turn a Raspberry Pi into a fullscreen player with its own Wi-Fi hotspot,
see the [Raspberry Pi player guide](readme/raspberry-pi.md). It covers
installation, hotspot setup, remote control-panel access, systemd startup,
and Chromium kiosk mode.

The guide also includes an interactive setup runner. It installs missing
system packages and Node.js 20+, configures the hotspot, saves the media
folder, installs the server service, and creates Chromium kiosk autostart:

```bash
bash scripts/setup-raspberry-pi.sh
```

## Project structure

```text
src/main/       Node.js HTTP server, settings, and native dialogs
src/renderer/   Fullscreen player
control-panel/  Angular control panel
scripts/        Build helpers
```

Application data is stored outside the repository in the operating system's
user data directory. On Windows this is under `%APPDATA%/merekaipresenter`;
on Linux and macOS it defaults to `$XDG_DATA_HOME/merekaipresenter` or
`~/.local/share/merekaipresenter`.

## Security notes

The server binds to `127.0.0.1` by default and does not provide remote access
or authentication. Keep it on localhost unless you understand the risks of
setting the `HOST` environment variable. The local-file API only serves media
inside the configured media folder and accepts supported image/video types.

Do not commit `.env` files, credentials, certificates, private keys, local
databases, or logs. Internal working notes in `prompts/` and `readme/` are
ignored by the repository's `.gitignore`.

## License

This project is licensed under the [MIT License](LICENSE).