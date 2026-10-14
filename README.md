# <img src="wombo-playing.gif" alt="Wombo mascot playing" width="96" height="96"> Wombo - The AI Game Studio

Wombo is created with the help of Codex and Astra. It allows you to create named characters, animations, and sounds from text prompts. Generate aligned side, front and back references, then create effectively any animation sequence (e.g. idle, walking, fighting) with automatically saved PNG and Aseprite files. Image and video calls use OpenRouter or RouterAI from the server; Sound & SFX uses ElevenLabs directly from the server.

## Character creation

Describe your character and generate aligned side, front and back reference views.

Attach an image for visual guidance and describe what to use from it, such as its art style or a specific character. Your text controls the subject and requested changes. Front and back views use the generated side view to keep the new character consistent.

Choose an art style from 8-bit Pixel, Cinematic Pixel, Cel-shaded 2D, or Storybook 3D. The selection is saved per character and carries into animation; Custom lets you describe the style in your own prompt.

![Creating character reference views in Wombo](ai-game-studio-character-angles.gif)

## Animation creation

Turn your character into an animation, choose the frames to include, and save spritesheets as PNG and Aseprite files.

![Creating sprite animations in Wombo](ai-game-studio-sprite-animation.gif)

## Example game: After Light

**After Light** is a 2.5D interplanetary-cyberpunk game currently being built using **Unity + Blender + Astra**, with 2D graphics and sound assets created in Wombo.

![After Light gameplay featuring sprite assets from Wombo](afterlight-demo.gif)

[Play the demo here.](https://acatovic.github.io/afterlight-play/)

## Setup and run

Requires Node.js 20+ and `ffmpeg` on your PATH. Frame extraction invokes `ffmpeg` directly; project ZIP export uses the installed `yazl` package.

```bash
npm install
cp .env.example .env
```

In `.env`, set `AI_PROVIDER` to `openrouter` or `routerai` and provide the matching `OPENROUTER_API_KEY` or `ROUTERAI_API_KEY` for animations. `IMAGE_MODEL` selects the default character image model. The example selects Pollinations FLUX.2 Klein 4B; create a key at [Pollinations API keys](https://enter.pollinations.ai/keys) with **Quest Pollen only** enabled, then set `POLLINATIONS_API_KEY`. The server verifies this restriction before every Pollinations generation and refuses to send the generation request if the key could spend paid Pollen. Quest credits are finite and generation stops when they run out. Existing OpenRouter and RouterAI image models remain selectable in the app. Set `ELEVENLABS_API_KEY` for Sound & SFX; each provider uses its own server-only key.

To use an OpenAI-compatible image server on another machine, set `IMAGE_API_BASE_URL` to its API base URL (for example `http://100.x.x.x:9001/v1`) and set `IMAGE_MODEL` to the exact model ID accepted by that server. The app will add that model to the image-model selector. Set `IMAGE_API_KEY` if the server requires bearer authentication; leave it empty for an unauthenticated endpoint. The server must provide `POST /images/generations` and `POST /images/edits` under that base URL, accept `response_format=b64_json`, and return an OpenAI-style `data[0].b64_json` image. The edit route is used to keep generated character views consistent. A Tailscale URL is reachable only if the machine running this app's backend is also connected to that tailnet. `IMAGE_API_BASE_URL` is server-side configuration; browsers never connect directly to the remote host. The custom API applies only to the model configured in `IMAGE_MODEL`; animation/video still uses `AI_PROVIDER`.

```bash
npm run dev
```

Open [localhost:5173](http://localhost:5173). Stop the app with `Ctrl+C`.

## Projects and storage

Choose **New Project** or **Open** on startup. Projects live outside the repository in `~/.ai-game-studio/`; set `AI_GAME_STUDIO_HOME` to use another location. Installation creates the storage directory.

```text
<project>/
├── .project               # Project manifest
├── sprites/<character>/   # References and animations/<animation>/
└── music/<sound>/         # Sound settings and audio revisions
```

Generated assets save automatically. **Save project**, switching assets, and **Close project** persist drafts. Each asset's JSON manifest points to its current files; older generated revisions are retained.

Every animation has an `assets/latest/` folder containing `<animation>.png` and `<animation>.aseprite`, copied from the files selected by `animation.json`. It is empty until output is generated. Generation, spritesheet updates, rename, and duplicate keep these convenient copies in sync. Opening an existing project also refreshes them. To backfill all stored animations without changing their manifests, run `npm run backfill:animation-latest`.

Use **Export** in the project header or beside a saved project in **Open** to download the entire project as a ZIP, including manifests and generated assets. Use **Import** on the start screen or in the header to add an exported project from your computer. Import checks the archive and referenced files before placing it in the storage directory. If a project with the same name exists, choose **Replace project**, **Rename import**, or **Cancel**. Replace deletes the existing project's files after the ZIP passes validation.

## Guides

- [Подключение удалённого API для генерации изображений (RU)](docs/remote-image-api.ru.md)
- [Create sprites and animations](docs/create-sprites-and-animations.md)
- [Create music and SFX](docs/create-music-and-sfx.md)
- [AGENTS.md](AGENTS.md) — architecture, implementation rules, and testing.
