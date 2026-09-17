"use strict";

import {
    api,
    type PlaybackCommand,
} from "./api";

// ============================================================
// PLAYER STATE
// ============================================================

let currentFolder = "";
let mediaList: string[] = [];
let currentIndex = 0;
let isPlaying = true;
let shuffle = false;
let slideDuration = 5;
let volume = 0.8;
let fitMode = "contain";
let kenBurns = false;
let playbackRate = 1;
let audioUnlocked = false;

// ============================================================
// INSERT MEDIA
// ============================================================

interface InsertSchedule {
    file: string;
    everyN: number;
    afterFolder: boolean;
    folderScope: "top" | "exact";
    onLoop: boolean;
    hideOverlays: boolean;
}

let insertSchedules: InsertSchedule[] = [];
let insertIndex = 0;
let pendingInsertSchedules: InsertSchedule[] = [];
let insertEveryN = 0;
let insertAfterFolder = false;
let insertFolderScope: "top" | "exact" = "top";
let insertOnLoop = false;
let insertHideOverlays = false;
let itemsPlayed = 0;

// ============================================================
// ALERT
// ============================================================

let alertFile = "";
let alertIntervalSeconds = 0;
let alertTimer: ReturnType<typeof setInterval> | null = null;
let savedVideoTime: number | null = null;

// ============================================================
// ORDER
// ============================================================

let mediaOrder: string[] = [];
let mediaHidden: string[] = [];

// ============================================================
// OVERLAYS
// ============================================================

interface OverlayLayer {
    id: string;
    template: string;
    css: string;
    enabled: boolean;
    type?:
        | "text"
        | "bar"
        | "square"
        | "circle"
        | "image"
        | "drawing";
    source?: string;
    fit?: "contain" | "cover";
    pathData?: string;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWidth?: number;
    fillColor?: string;
    fillOpacity?: number;
}

let overlayLayers: OverlayLayer[] = [];

// ============================================================
// SPECIAL PLAYBACK
// ============================================================

let playingSpecial = false;
let specialPlaybackKind: "insert" | "alert" | null = null;
let playTimeout: ReturnType<typeof setTimeout> | null = null;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let currentMediaType: "image" | "video" | null = null;
let currentMediaDuration = 0;
let imageStartedAt = 0;
let imageElapsedAtPause = 0;

// ============================================================
// DOM
// ============================================================

const imgElement =
    document.querySelector<HTMLImageElement>(
        "#img-media",
    );

const videoElement =
    document.querySelector<HTMLVideoElement>(
        "#video-media",
    );

const messageElement =
    document.querySelector<HTMLElement>(
        "#message",
    );

const overlaysElement =
    document.querySelector<HTMLElement>(
        "#overlays",
    );

if (!imgElement) {
    throw new Error(
        'No se encontró el elemento "#img-media".',
    );
}

if (!videoElement) {
    throw new Error(
        'No se encontró el elemento "#video-media".',
    );
}

if (!messageElement) {
    throw new Error(
        'No se encontró el elemento "#message".',
    );
}

if (!overlaysElement) {
    throw new Error(
        'No se encontró el elemento "#overlays".',
    );
}

const img = imgElement;
const video = videoElement;
const message = messageElement;
const overlays = overlaysElement;

// ============================================================
// CONSTANTS
// ============================================================

const playbackRates = [
    0.5,
    0.75,
    1,
    1.25,
    1.5,
    2,
];

// ============================================================
// MEDIA HELPERS
// ============================================================

function isImage(file: string): boolean {
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(file);
}

function isVideo(file: string): boolean {
    return /\.(mp4|webm)$/i.test(file);
}

function folderOf(file: string): string {
    const normalized = file.replace(/\\/g, "/");

    return normalized.includes("/")
        ? normalized.slice(
              0,
              normalized.lastIndexOf("/"),
          )
        : "";
}

function isHiddenMedia(filePath: string): boolean {
    return mediaHidden.some((entry) =>
        entry.endsWith("/")
            ? filePath.startsWith(entry)
            : filePath === entry,
    );
}

function normalizeMediaReference(value: string): string {
    const normalized = value.replace(/\\/g, "/");
    const normalizedFolder = currentFolder.replace(/\\/g, "/").replace(/\/$/, "");

    if (normalizedFolder && normalized.startsWith(`${normalizedFolder}/`)) {
        return normalized.slice(normalizedFolder.length + 1);
    }

    return normalized.replace(/^\.\//, "");
}

function isSpecialMedia(filePath: string): boolean {
    const references = [
        alertFile,
        ...insertSchedules.map((schedule) => schedule.file),
    ];

    return references.some((reference) =>
        reference.trim() !== "" &&
        normalizeMediaReference(reference) === normalizeMediaReference(filePath),
    );
}

// ============================================================
// SETTINGS HELPERS
// ============================================================

function parseIntegerSetting(
    raw: string | null,
    fallback: number,
    min = 0,
): number {
    const parsed = Number.parseInt(
        raw ?? "",
        10,
    );

    return Number.isFinite(parsed) &&
        parsed >= min
        ? parsed
        : fallback;
}

function parseDecimalSetting(
    raw: string | null,
    fallback: number,
    min: number,
    max: number,
): number {
    const parsed = Number.parseFloat(
        raw ?? "",
    );

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(
        max,
        Math.max(min, parsed),
    );
}

function parseJsonSetting<T>(
    raw: string | null,
    fallback: T,
): T {
    try {
        return raw
            ? (JSON.parse(raw) as T)
            : fallback;
    } catch {
        return fallback;
    }
}

// ============================================================
// FOLDER GROUP
// ============================================================

function folderGroupOf(
    filePath: string,
    scope: "top" | "exact" = insertFolderScope,
): string {
    const parentFolder = folderOf(
        filePath,
    );

    if (!parentFolder) {
        return "";
    }

    if (
        scope ===
        "exact"
    ) {
        return parentFolder;
    }

    return (
        parentFolder.split("/")[0] ?? ""
    );
}

// ============================================================
// MEDIA URL
// ============================================================

function toMediaUrl(
    filePath: string,
): string {
    if (!filePath) {
        return "";
    }

    const value = filePath.replace(
        /\\/g,
        "/",
    );

    // URLs externas.
    if (
        /^(https?:|data:|blob:|file:)/i.test(
            value,
        )
    ) {
        return value;
    }

    const normalizedFolder =
        currentFolder
            .replace(
                /\\/g,
                "/",
            )
            .replace(
                /\/+$/,
                "",
            );

    let relativePath = value;

    /*
     * Ruta absoluta dentro de
     * currentFolder.
     */
    if (
        normalizedFolder &&
        value.startsWith(
            normalizedFolder + "/",
        )
    ) {
        relativePath =
            value.slice(
                normalizedFolder.length + 1,
            );
    }

    /*
     * Eliminamos barras iniciales.
     */
    relativePath =
        relativePath.replace(
            /^[\\/]+/,
            "",
        );

    if (
        /^(?:[a-zA-Z]:\/|\/|\/\/)/.test(
            value,
        )
    ) {
        return `/api/local-file?path=${encodeURIComponent(
            filePath,
        )}`;
    }

    return (
        "/media/" +
        relativePath
            .split("/")
            .filter(Boolean)
            .map(
                encodeURIComponent,
            )
            .join("/")
    );
}

// ============================================================
// INIT
// ============================================================

async function init(): Promise<void> {
    // Ensure the mouse cursor is hidden in kiosk mode across X11/Wayland
    // Re-apply periodically to counteract any compositor/browser overrides.
    try {
        const enforceCursorHidden = (): void => {
            try {
                document.documentElement.style.cursor = "none";
                document.body.style.cursor = "none";
            } catch {}
        };

        enforceCursorHidden();
        // Reapply every second.
        setInterval(enforceCursorHidden, 1000);

        // Also ensure any mousemove doesn't re-show the cursor by forcing none.
        window.addEventListener("mousemove", () => enforceCursorHidden(), { passive: true });
    } catch {}

    currentFolder =
        (await api.getSetting(
            "mediaFolder",
        )) || "";

    slideDuration =
        parseIntegerSetting(
            await api.getSetting(
                "slideDurationSeconds",
            ),
            5,
            1,
        );

    shuffle =
        (await api.getSetting(
            "shuffle",
        )) === "true";

    volume =
        parseDecimalSetting(
            await api.getSetting(
                "volume",
            ),
            0.8,
            0,
            1,
        );

    fitMode =
        (await api.getSetting(
            "fitMode",
        )) || "contain";

    kenBurns =
        (await api.getSetting(
            "kenBurns",
        )) === "true";

    const configuredSchedules = await api.getSetting("insertSchedules");
    try {
        const parsed = configuredSchedules ? JSON.parse(configuredSchedules) : [];
        insertSchedules = Array.isArray(parsed)
            ? parsed
                  .filter((schedule): schedule is InsertSchedule => Boolean(schedule?.file))
                  .map((schedule) => ({
                      file: String(schedule.file).trim(),
                      everyN: Math.max(0, Number(schedule.everyN) || 0),
                      afterFolder: schedule.afterFolder === true,
                      folderScope: schedule.folderScope === "exact" ? "exact" : "top",
                      onLoop: schedule.onLoop === true,
                      hideOverlays: schedule.hideOverlays === true,
                  }))
            : [];
    } catch {
        insertSchedules = [];
    }

    if (insertSchedules.length === 0) {
        const legacyFile = (await api.getSetting("insertFile")) || "";
        if (legacyFile.trim()) {
            insertSchedules = [{
                file: legacyFile.trim(),
                everyN: parseIntegerSetting(await api.getSetting("insertEveryN"), 0, 0),
                afterFolder: (await api.getSetting("insertAfterFolder")) === "true",
                folderScope: (await api.getSetting("insertFolderScope")) === "exact" ? "exact" : "top",
                onLoop: (await api.getSetting("insertOnLoop")) === "true",
                hideOverlays: (await api.getSetting("insertHideOverlays")) === "true",
            }];
        }
    }

    insertIndex = 0;
    pendingInsertSchedules = [];

    insertEveryN = insertSchedules[0]?.everyN || 0;

    insertAfterFolder = insertSchedules[0]?.afterFolder || false;

    insertFolderScope = insertSchedules[0]?.folderScope || "top";

    insertOnLoop = insertSchedules[0]?.onLoop || false;

    insertHideOverlays = insertSchedules[0]?.hideOverlays || false;

    alertFile =
        (await api.getSetting(
            "alertFile",
        )) || "";

    alertIntervalSeconds =
        parseIntegerSetting(
            await api.getSetting(
                "alertIntervalSeconds",
            ),
            0,
            0,
        );

    document.body.style.backgroundColor =
        (await api.getSetting(
            "bodyBackgroundColor",
        )) || "#000000";

    mediaOrder =
        parseJsonSetting(
            await api.getSetting(
                "mediaOrder",
            ),
            [] as string[],
        );

    mediaHidden =
        parseJsonSetting(
            await api.getSetting(
                "mediaHidden",
            ),
            [] as string[],
        );

    overlayLayers =
        parseJsonSetting(
            await api.getSetting(
                "overlayLayers",
            ),
            [] as OverlayLayer[],
        );

    console.log(
        "🎬 Renderer init",
    );

    console.log(
        "📁 mediaFolder:",
        currentFolder,
    );

    console.log(
        "📋 mediaOrder:",
        mediaOrder,
    );

    img.style.objectFit =
        fitMode;

    video.style.objectFit =
        fitMode;

    video.volume = volume;

    /*
     * Alert periódico.
     */
    if (
        alertFile &&
        alertIntervalSeconds > 0
    ) {
        if (alertTimer) {
            clearInterval(
                alertTimer,
            );
        }

        alertTimer =
            setInterval(
                triggerAlert,
                alertIntervalSeconds *
                    1000,
            );
    }

    if (!currentFolder) {
        showMessage(
            "Pulsa O para abrir una carpeta de medios.",
        );
        return;
    }

    await loadFolder(
        currentFolder,
    );
}

// ============================================================
// LOAD FOLDER
// ============================================================

async function loadFolder(
    folder: string,
): Promise<void> {
    currentFolder = folder;

    /*
     * IMPORTANTE:
     *
     * No hacemos api.setSetting() aquí.
     *
     * La carpeta se guarda mediante
     * /api/set-media-folder.
     *
     * Si hiciéramos setSetting() aquí,
     * podríamos provocar:
     *
     * setSetting
     *   -> settings-changed
     *   -> reload
     *   -> init
     *   -> loadFolder
     *   -> setSetting
     *   -> ...
     */

    mediaList =
        await api.listMedia(
            folder,
        );

    mediaList = mediaList.filter((filePath) => !isSpecialMedia(filePath));

    if (
        mediaList.length ===
        0
    ) {
        showMessage(
            "No se encontraron medios. Pulsa O para elegir otra carpeta.",
        );
        return;
    }

    console.log(
        "📁 Folder:",
        folder,
    );

    console.log(
        "📋 Media:",
        mediaList,
    );

    /*
     * Aplicar orden guardado.
     */
    if (
        mediaOrder.length > 0
    ) {
        const known =
            new Set(
                mediaList,
            );

        const ordered =
            mediaOrder.filter(
                (
                    filePath,
                ) =>
                    known.has(
                        filePath,
                    ) && !isHiddenMedia(filePath),
            );

        const missing =
            mediaList.filter(
                (
                    filePath,
                ) =>
                    !ordered.includes(
                        filePath,
                    ) && !isHiddenMedia(filePath),
            );

        mediaList = [
            ...ordered,
            ...missing,
        ];
    } else if (shuffle) {
        mediaList = mediaList.filter((filePath) => !isHiddenMedia(filePath));
        mediaList.sort(
            () =>
                Math.random() -
                0.5,
        );
    }

    if (mediaList.length === 0) {
        showMessage("No visible media is configured.");
        return;
    }

    currentIndex = 0;
    itemsPlayed = 0;

    playingSpecial = false;
    specialPlaybackKind = null;

    showMessage("");

    play();
}

// ============================================================
// SHOW MEDIA
// ============================================================

function showMedia(
    filePath: string,
    onEnd: () => void,
    resumeTime?: number,
): void {
    const url =
        toMediaUrl(
            filePath,
        );

    if (playTimeout) {
        clearTimeout(
            playTimeout,
        );

        playTimeout = null;
    }

    video.onended = null;
    video.onloadedmetadata =
        null;
    video.onerror = null;
    currentMediaType = isImage(filePath) ? "image" : isVideo(filePath) ? "video" : null;
    currentMediaDuration = isImage(filePath) ? slideDuration : 0;
    imageStartedAt = performance.now();
    imageElapsedAtPause = 0;

    if (progressTimer) {
        clearInterval(progressTimer);
    }

    progressTimer = setInterval(() => reportPlaybackState(filePath), 500);

    if (isImage(filePath)) {
        video.pause();

        video.removeAttribute(
            "src",
        );

        video.load();

        video.classList.remove(
            "visible",
        );

        img.src = url;

        img.classList.remove(
            "ken-burns",
        );

        img.classList.add(
            "visible",
        );

        if (kenBurns) {
            img.style.setProperty(
                "--kb-duration",
                `${slideDuration}s`,
            );

            void img.offsetWidth;

            img.classList.add(
                "ken-burns",
            );
        }

        if (isPlaying) {
            playTimeout =
                setTimeout(
                    onEnd,
                    (
                        slideDuration *
                        1000
                    ) /
                        playbackRate,
                );
        }
    } else if (isVideo(filePath)) {
        img.classList.remove(
            "visible",
        );

        video.src = url;

        video.muted =
            !audioUnlocked;

        video.volume = volume;

        video.playbackRate =
            playbackRate;

        video.classList.add(
            "visible",
        );

        video.onended = onEnd;

        video.onloadedmetadata =
            () => {
                currentMediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
                reportPlaybackState(filePath);

                if (
                    resumeTime !==
                        undefined &&
                    Number.isFinite(
                        resumeTime,
                    )
                ) {
                    try {
                        video.currentTime =
                            resumeTime;
                    } catch {
                        // Ignore invalid seek.
                    }
                }
            };

        video.onerror = () => {
            console.warn(
                "Video load failed:",
                filePath,
                video.error,
            );

            next();
        };

        if (isPlaying) {
            void playVideo(
                filePath,
            );
        }
    } else {
        console.warn(
            "Tipo de media no soportado:",
            filePath,
        );

        onEnd();
        return;
    }

    preloadNext();

    applyOverlays(
        filePath,
    );

    reportPlaybackState(
        filePath,
    );
}

async function playVideo(
    filePath: string,
): Promise<void> {
    try {
        await video.play();
        return;
    } catch (error: unknown) {
        console.warn(
            "Video autoplay failed:",
            error,
        );
    }

    if (!video.muted) {
        try {
            video.muted = true;
            await video.play();

            return;
        } catch (retryError: unknown) {
            console.warn(
                "Muted video autoplay failed:",
                retryError,
            );
        }
    }

    next();
}

function unlockAudioPlayback(): void {
    if (audioUnlocked) {
        return;
    }

    audioUnlocked = true;
    video.muted = false;
    video.volume = volume;

    if (
        video.classList.contains(
            "visible",
        ) &&
        isPlaying
    ) {
        void video.play().catch(
            (error: unknown) => {
                console.warn(
                    "Unable to resume video with audio:",
                    error,
                );
            },
        );
    }

    showMessage("");
}

// ============================================================
// PLAYBACK STATE
// ============================================================

function reportPlaybackState(
    displayedPath?: string,
): void {
    const current =
        displayedPath ??
        mediaList[
            currentIndex
        ] ??
        null;

    const next =
        mediaList.length > 0
            ? mediaList[
                  (currentIndex + 1) %
                      mediaList.length
              ] ?? null
            : null;

    const elapsedSeconds =
        currentMediaType === "video"
            ? Math.max(0, video.currentTime || 0)
            : isPlaying
                ? imageElapsedAtPause + ((performance.now() - imageStartedAt) / 1000) * playbackRate
                : imageElapsedAtPause;

    const state = {
        current,
        next,
        playlist: mediaList,
        elapsedSeconds: Math.min(elapsedSeconds, currentMediaDuration || elapsedSeconds),
        durationSeconds: currentMediaDuration,
        mediaType: currentMediaType,
        index: currentIndex,
        total: mediaList.length,
        isPlaying,
        playingSpecial,
        specialPlaybackKind,
    };

    void api
        .sendPlaybackState(
            state,
        )
        .catch(
            (error: unknown) => {
                console.warn(
                    "No se pudo enviar playback state:",
                    error,
                );
            },
        );
}

// ============================================================
// OVERLAYS
// ============================================================

function applyOverlays(
    filePath: string,
): void {
    if (
        playingSpecial &&
        specialPlaybackKind ===
            "insert" &&
        insertHideOverlays
    ) {
        overlays.innerHTML = "";
        return;
    }

    const context =
        buildOverlayContext(
            filePath,
        );

    overlays.innerHTML = "";

    for (
        const layer of overlayLayers
    ) {
        if (!layer.enabled) {
            continue;
        }

        const type =
            layer.type ??
            "text";

        const element =
            createOverlayElement(
                type,
                layer,
                context,
            );

        element.style.cssText =
            layer.css || "";

        overlays.appendChild(
            element,
        );
    }
}

function createOverlayElement(
    type: NonNullable<
        OverlayLayer["type"]
    >,
    layer: OverlayLayer,
    context: ReturnType<
        typeof buildOverlayContext
    >,
): HTMLElement | SVGSVGElement {
    if (type === "image") {
        const image =
            document.createElement(
                "img",
            );

        image.src =
            resolveOverlaySource(
                layer.source ||
                    "",
            );

        image.alt =
            renderOverlayTemplate(
                layer.template ||
                    "Overlay image",
                context,
            );

        if (layer.fit) {
            image.style.objectFit =
                layer.fit;
        }

        return image;
    }

    if (type === "drawing") {
        const svg =
            document.createElementNS(
                "http://www.w3.org/2000/svg",
                "svg",
            );

        svg.setAttribute(
            "viewBox",
            "0 0 100 100",
        );

        svg.setAttribute(
            "preserveAspectRatio",
            "none",
        );

        const drawingPath =
            document.createElementNS(
                "http://www.w3.org/2000/svg",
                "path",
            );

        drawingPath.setAttribute(
            "d",
            layer.pathData ||
                "M8 70 C 22 12, 38 88, 52 34 S 80 18, 92 70",
        );

        drawingPath.setAttribute(
            "fill",
            toOverlayColor(
                layer.fillColor,
                layer.fillOpacity,
                "transparent",
            ),
        );

        drawingPath.setAttribute(
            "stroke",
            toOverlayColor(
                layer.strokeColor,
                layer.strokeOpacity,
                "#ffffff",
            ),
        );

        drawingPath.setAttribute(
            "stroke-width",
            String(
                layer.strokeWidth ||
                    6,
            ),
        );

        drawingPath.setAttribute(
            "stroke-linecap",
            "round",
        );

        drawingPath.setAttribute(
            "stroke-linejoin",
            "round",
        );

        svg.appendChild(
            drawingPath,
        );

        return svg;
    }

    const element =
        document.createElement(
            "div",
        );

    if (type === "text") {
        element.textContent =
            renderOverlayTemplate(
                layer.template ||
                    "",
                context,
            );
    }

    return element;
}

function buildOverlayContext(
    filePath: string,
) {
    const normalizedPath =
        filePath.replace(
            /\\/g,
            "/",
        );

    const filename =
        normalizedPath
            .split("/")
            .pop() ?? "";

    const lastDot =
        filename.lastIndexOf(
            ".",
        );

    const filenameNoExt =
        lastDot > 0
            ? filename.slice(
                  0,
                  lastDot,
              )
            : filename;

    const extension =
        lastDot > 0
            ? filename.slice(
                  lastDot + 1,
              )
            : "";

    const folderPath =
        folderOf(
            normalizedPath,
        );

    const parentFolder =
        folderPath
            .split("/")
            .pop() ?? "";

    return {
        filename,
        filenameNoExt,
        extension,
        parentFolder,
        folderPath,
        filePath: normalizedPath,
        index:
            currentIndex + 1,
        total:
            mediaList.length,
    };
}

function renderOverlayTemplate(
    template: string,
    context: ReturnType<
        typeof buildOverlayContext
    >,
): string {
    return template
        .replaceAll(
            "{filename}",
            context.filename,
        )
        .replaceAll(
            "{filenameNoExt}",
            context.filenameNoExt,
        )
        .replaceAll(
            "{extension}",
            context.extension,
        )
        .replaceAll(
            "{parentFolder}",
            context.parentFolder,
        )
        .replaceAll(
            "{folderPath}",
            context.folderPath,
        )
        .replaceAll(
            "{filePath}",
            context.filePath,
        )
        .replaceAll(
            "{index}",
            String(
                context.index,
            ),
        )
        .replaceAll(
            "{total}",
            String(
                context.total,
            ),
        );
}

function toOverlayColor(
    hex: string | undefined,
    opacity: number | undefined,
    fallback: string,
): string {
    if (!hex) {
        return fallback;
    }

    const alpha =
        Number.isFinite(
            opacity,
        )
            ? Math.max(
                  0,
                  Math.min(
                      (opacity as number) /
                          100,
                      1,
                  ),
              )
            : 1;

    const normalized =
        hex.replace(
            "#",
            "",
        );

    const full =
        normalized.length === 3
            ? normalized
                  .split("")
                  .map(
                      (
                          char,
                      ) =>
                          char +
                          char,
                  )
                  .join("")
            : normalized;

    if (
        full.length !== 6
    ) {
        return fallback;
    }

    const red =
        Number.parseInt(
            full.slice(0, 2),
            16,
        );

    const green =
        Number.parseInt(
            full.slice(2, 4),
            16,
        );

    const blue =
        Number.parseInt(
            full.slice(4, 6),
            16,
        );

    if (
        !Number.isFinite(red) ||
        !Number.isFinite(green) ||
        !Number.isFinite(blue)
    ) {
        return fallback;
    }

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function resolveOverlaySource(
    source: string,
): string {
    if (!source) {
        return "";
    }

    if (
        /^(https?:|data:|blob:|file:)/i.test(
            source,
        )
    ) {
        return source;
    }

    return toMediaUrl(
        source,
    );
}

// ============================================================
// PRELOAD NEXT
// ============================================================

function preloadNext(): void {
    if (
        mediaList.length < 2
    ) {
        return;
    }

    const next =
        mediaList[
            (currentIndex + 1) %
                mediaList.length
        ];

    if (!next) {
        return;
    }

    if (isImage(next)) {
        const image =
            new Image();

        image.src =
            toMediaUrl(
                next,
            );
    }
}

// ============================================================
// PLAYBACK
// ============================================================

function play(): void {
    if (
        mediaList.length ===
        0
    ) {
        return;
    }

    const current =
        mediaList[
            currentIndex
        ];

    if (!current) {
        return;
    }

    /*
     * IMPORTANTE:
     * Debe establecerse antes de showMedia().
     *
     * Las imágenes comprueban isPlaying para
     * crear su temporizador.
     */
    isPlaying = true;

    showMedia(
        current,
        next,
    );

    reportPlaybackState(
        current,
    );
}

function playAtIndex(index: number): void {
    if (
        index < 0 ||
        index >= mediaList.length
    ) {
        return;
    }

    currentIndex = index;
    playingSpecial = false;
    specialPlaybackKind = null;
    itemsPlayed = 0;
    play();
}

function next(): void {
    if (
        mediaList.length ===
        0
    ) {
        return;
    }

    /*
     * Si estábamos reproduciendo
     * un elemento especial.
     */
    if (playingSpecial) {
        playingSpecial = false;
        specialPlaybackKind = null;

        play();

        return;
    }

    const currentPath =
        mediaList[
            currentIndex
        ];

    if (!currentPath) {
        return;
    }

    itemsPlayed++;

    currentIndex =
        (
            currentIndex +
            1
        ) %
        mediaList.length;

    const nextPath =
        mediaList[
            currentIndex
        ];

    if (!nextPath) {
        return;
    }

    const looped =
        currentIndex === 0;

    const dueSchedules = insertSchedules.filter((schedule) => {
        const folderChanged =
            folderGroupOf(nextPath, schedule.folderScope) !==
            folderGroupOf(currentPath, schedule.folderScope);

        return schedule.everyN > 0 && itemsPlayed % schedule.everyN === 0 ||
            schedule.afterFolder && folderChanged ||
            schedule.onLoop && looped;
    });

    if (dueSchedules.length > 0) {
        pendingInsertSchedules.push(...dueSchedules);
        playScheduledInsert();

        return;
    }

    play();
}

function prev(): void {
    if (
        mediaList.length ===
        0
    ) {
        return;
    }

    currentIndex =
        (
            currentIndex -
            1 +
            mediaList.length
        ) %
        mediaList.length;

    playingSpecial = false;

    specialPlaybackKind =
        null;

    play();
}

// ============================================================
// PLAY / PAUSE
// ============================================================

function togglePlay(): void {
    if (isPlaying) {
        pausePlayback();
    } else {
        resumePlayback();
    }
}

function pausePlayback(): void {
    if (currentMediaType === "image") {
        imageElapsedAtPause = Math.min(
            currentMediaDuration,
            imageElapsedAtPause + ((performance.now() - imageStartedAt) / 1000) * playbackRate,
        );
    }

    isPlaying = false;

    video.pause();

    if (playTimeout) {
        clearTimeout(
            playTimeout,
        );

        playTimeout = null;
    }

    reportPlaybackState();
}

function resumePlayback(): void {
    if (isPlaying) {
        if (
            video.classList.contains(
                "visible",
            )
        ) {
            video.playbackRate =
                playbackRate;

            const promise =
                video.play();

            promise.catch(
                console.warn,
            );
        }

        return;
    }

    isPlaying = true;

    if (
        video.classList.contains(
            "visible",
        )
    ) {
        video.playbackRate =
            playbackRate;

        const promise =
            video.play();

        promise.catch(
            console.warn,
        );

        reportPlaybackState();

        return;
    }

    play();

    reportPlaybackState();
}

// ============================================================
// PLAYBACK RATE
// ============================================================

function stepPlaybackRate(
    direction: -1 | 1,
): void {
    const index =
        playbackRates.indexOf(
            playbackRate,
        );

    const currentRateIndex =
        index >= 0
            ? index
            : playbackRates.indexOf(
                  1,
              );

    const nextIndex =
        Math.min(
            playbackRates.length -
                1,
            Math.max(
                0,
                currentRateIndex +
                    direction,
            ),
        );

    const nextRate =
        playbackRates[
            nextIndex
        ];

    if (
        nextRate ===
            undefined ||
        nextRate ===
            playbackRate
    ) {
        return;
    }

    playbackRate =
        nextRate;

    if (
        video.classList.contains(
            "visible",
        )
    ) {
        video.playbackRate =
            playbackRate;
    }

    if (
        img.classList.contains(
            "visible",
        ) &&
        isPlaying
    ) {
        play();
    }

    reportPlaybackState();
}

// ============================================================
// COMMANDS
// ============================================================

function handlePlaybackCommand(
    command: PlaybackCommand,
    index?: number,
): void {
    switch (command) {
        case "play":
            if (index !== undefined) {
                playAtIndex(index);
            } else {
                resumePlayback();
            }
            break;

        case "pause":
            pausePlayback();
            break;

        case "back":
            prev();
            break;

        case "next":
            next();
            break;

        case "fast":
            stepPlaybackRate(
                1,
            );
            break;

        case "slow":
            stepPlaybackRate(
                -1,
            );
            break;

        case "insert":
            triggerInsert();
            break;

        case "alert":
            triggerAlert();
            break;
    }
}

// ============================================================
// ALERT
// ============================================================

function triggerInsert(): void {
    if (
        insertSchedules.length === 0 ||
        playingSpecial ||
        mediaList.length === 0
    ) {
        return;
    }

    playingSpecial = true;
    specialPlaybackKind = "insert";
    savedVideoTime = video.classList.contains("visible") ? video.currentTime : null;

    const schedule = insertSchedules[insertIndex % insertSchedules.length];
    insertIndex = (insertIndex + 1) % insertSchedules.length;
    insertHideOverlays = schedule.hideOverlays;
    showMedia(schedule.file, resumeAfterInsert);
}

function playScheduledInsert(): void {
    const schedule = pendingInsertSchedules.shift();
    if (!schedule) {
        playingSpecial = false;
        specialPlaybackKind = null;
        play();
        return;
    }

    playingSpecial = true;
    specialPlaybackKind = "insert";
    insertHideOverlays = schedule.hideOverlays;
    showMedia(schedule.file, playScheduledInsert);
}

function resumeAfterInsert(): void {
    playingSpecial = false;
    specialPlaybackKind = null;

    const resumeTime = savedVideoTime ?? undefined;
    savedVideoTime = null;
    const current = mediaList[currentIndex];

    if (!current) {
        return;
    }

    showMedia(current, next, resumeTime);
}

function triggerAlert(): void {
    if (
        !alertFile ||
        playingSpecial ||
        mediaList.length ===
            0
    ) {
        return;
    }

    playingSpecial = true;

    specialPlaybackKind =
        "alert";

    savedVideoTime =
        video.classList.contains(
            "visible",
        )
            ? video.currentTime
            : null;

    showMedia(
        alertFile,
        resumeAfterAlert,
    );
}

function resumeAfterAlert(): void {
    playingSpecial = false;

    specialPlaybackKind =
        null;

    const resumeTime =
        savedVideoTime ??
        undefined;

    savedVideoTime = null;

    const current =
        mediaList[
            currentIndex
        ];

    if (!current) {
        return;
    }

    showMedia(
        current,
        next,
        resumeTime,
    );
}

// ============================================================
// MESSAGE
// ============================================================

function showMessage(
    text: string,
): void {
    message.textContent =
        text;

    message.style.display =
        text
            ? "block"
            : "none";
}

// ============================================================
// FOLDER PICKER
// ============================================================

async function pickFolder(): Promise<void> {
    try {
        const folder =
            await api.pickFolder();

        if (!folder) {
            return;
        }

        /*
         * El servidor guarda la nueva carpeta
         * y emite settings-changed por SSE.
         *
         * El listener de abajo hará reload(),
         * y init() volverá a cargar mediaFolder.
         */
        await api.setMediaFolder(
            folder,
        );
    } catch (error: unknown) {
        console.warn(
            "Selector de carpeta no disponible:",
            error,
        );
    }
}

// ============================================================
// KEYBOARD
// ============================================================

document.addEventListener(
    "keydown",
    async (event) => {
        unlockAudioPlayback();

        switch (event.key) {
            case " ":
                event.preventDefault();
                togglePlay();
                break;

            case "ArrowRight":
                event.preventDefault();
                next();
                break;

            case "ArrowLeft":
                event.preventDefault();
                prev();
                break;

            case "o":
            case "O":
                event.preventDefault();
                await pickFolder();
                break;

            case "f":
            case "F":
                event.preventDefault();

                try {
                    if (
                        document.fullscreenElement
                    ) {
                        await document.exitFullscreen();
                    } else {
                        await document.documentElement.requestFullscreen();
                    }
                } catch (
                    error
                ) {
                    console.warn(
                        "No se pudo cambiar fullscreen:",
                        error,
                    );
                }

                break;

            case "a":
            case "A":
                event.preventDefault();
                triggerAlert();
                break;

            case "Escape":
                if (
                    document.fullscreenElement
                ) {
                    try {
                        await document.exitFullscreen();
                    } catch (
                        error
                    ) {
                        console.warn(
                            "No se pudo salir de fullscreen:",
                            error,
                        );
                    }
                }

                break;
        }
    },
);

document.addEventListener(
    "pointerdown",
    () => {
        unlockAudioPlayback();
    },
);

// ============================================================
// VIDEO EVENTS
// ============================================================

video.addEventListener(
    "play",
    () => {
        video.volume =
            volume;

        video.playbackRate =
            playbackRate;
    },
);

video.addEventListener(
    "volumechange",
    () => {
        /*
         * El volumen viene de settings.
         */
        if (
            video.volume !==
            volume
        ) {
            video.volume =
                volume;
        }
    },
);

// ============================================================
// SSE EVENTS
// ============================================================

api.onSettingsChanged(
    () => {
        /*
         * El panel ha modificado
         * configuración.
         *
         * Recargamos todo el player.
         */
        window.location.reload();
    },
);

api.onPlaybackCommand(
    (
        command,
        index,
    ) => {
        handlePlaybackCommand(
            command,
            index,
        );
    },
);

// ============================================================
// START
// ============================================================

void init();