import "./style.css";
import { inspectIvfPackage, type InspectedIvfPackage, type ChoiceInteraction } from "@ivf/core";
import { findBlockedSeekTarget, findDueInteraction, orderedInteractions } from "./timeline";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app element.");

app.innerHTML = `
  <main class="player">
    <header>
      <div>
        <p class="eyebrow">Interactive Video Format</p>
        <h1>IVF Player</h1>
      </div>
      <label class="file-button">
        Open .ivxpkg
        <input id="package-input" type="file" accept=".ivxpkg,application/zip" />
      </label>
    </header>

    <section id="status" class="status" role="status">Choose a package to begin.</section>

    <section id="experience" class="experience" hidden>
      <div class="video-shell">
        <video id="video" controls preload="metadata"></video>
        <aside id="choice" class="choice" hidden>
          <p id="choice-prompt"></p>
          <div id="choice-options" class="choice-options"></div>
        </aside>
      </div>
      <h2 id="package-title"></h2>
      <p id="scene-name" class="scene-name"></p>
    </section>
  </main>
`;

const input = document.querySelector<HTMLInputElement>("#package-input")!;
const status = document.querySelector<HTMLElement>("#status")!;
const experience = document.querySelector<HTMLElement>("#experience")!;
const video = document.querySelector<HTMLVideoElement>("#video")!;
const choice = document.querySelector<HTMLElement>("#choice")!;
const choicePrompt = document.querySelector<HTMLElement>("#choice-prompt")!;
const choiceOptions = document.querySelector<HTMLElement>("#choice-options")!;
const packageTitle = document.querySelector<HTMLElement>("#package-title")!;
const sceneName = document.querySelector<HTMLElement>("#scene-name")!;

let inspected: InspectedIvfPackage | undefined;
let sceneId: string | undefined;
let activeInteraction: ChoiceInteraction | undefined;
let resolvedIds = new Set<string>();
let mediaUrl: string | undefined;
let seekingTarget: number | undefined;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function clearMediaUrl(): void {
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = undefined;
}

async function loadScene(nextSceneId: string, autoplay = false): Promise<void> {
  if (!inspected) return;
  const scene = inspected.manifest.scenes[nextSceneId];
  if (!scene) {
    setStatus(`The package references missing scene "${nextSceneId}".`, true);
    return;
  }

  sceneId = nextSceneId;
  activeInteraction = undefined;
  resolvedIds = new Set();
  choice.hidden = true;
  choiceOptions.replaceChildren();
  sceneName.textContent = `Scene: ${nextSceneId}`;

  const file = await inspected.readFile(scene.video);
  if (!file.ok) {
    setStatus(file.issues.map((issue) => issue.message).join(" "), true);
    return;
  }

  clearMediaUrl();
  const bytes = Uint8Array.from(file.value);
  mediaUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
  video.src = mediaUrl;
  video.load();

  if (autoplay) {
    try {
      await video.play();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Scene loaded, but playback could not start automatically: ${error.message}`
          : "Scene loaded, but playback could not start automatically.",
        true,
      );
      return;
    }
  }

  setStatus(`Playing "${inspected.manifest.title}"`);
}

function showInteraction(interaction: ChoiceInteraction): void {
  if (!inspected || !sceneId) return;
  activeInteraction = interaction;
  video.pause();
  choicePrompt.textContent = interaction.prompt;
  choiceOptions.replaceChildren();

  for (const option of interaction.options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      void loadScene(option.next_scene, true);
    });
    choiceOptions.append(button);
  }
  choice.hidden = false;
}

function monitorTimeline(): void {
  if (!inspected || !sceneId || activeInteraction) return;
  const scene = inspected.manifest.scenes[sceneId];
  if (!scene) return;
  const interaction = findDueInteraction(scene.interactions, video.currentTime, resolvedIds);
  if (interaction) {
    resolvedIds.add(interaction.id);
    showInteraction(interaction);
  }
}

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;

  setStatus(`Validating "${file.name}"...`);
  experience.hidden = true;
  clearMediaUrl();

  try {
    const result = await inspectIvfPackage(new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) {
      setStatus(result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"), true);
      return;
    }

    inspected = result.value;
    packageTitle.textContent = inspected.manifest.title;
    experience.hidden = false;
    await loadScene(inspected.manifest.entry_scene);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to read package.", true);
  }
});

video.addEventListener("timeupdate", monitorTimeline);
video.addEventListener("play", monitorTimeline);

video.addEventListener("seeking", () => {
  if (!inspected || !sceneId || activeInteraction) return;
  const scene = inspected.manifest.scenes[sceneId];
  if (!scene) return;

  const blockedTarget = findBlockedSeekTarget(
    orderedInteractions(scene.interactions),
    video.currentTime,
    resolvedIds,
  );
  if (blockedTarget !== undefined) {
    seekingTarget = blockedTarget;
  }
});

video.addEventListener("seeked", () => {
  if (seekingTarget === undefined) return;
  const target = seekingTarget;
  seekingTarget = undefined;
  video.currentTime = target;
  setStatus("Seeking past an unresolved interaction is not allowed.");
});
