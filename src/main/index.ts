"use strict";

import http, {
    IncomingMessage,
    ServerResponse,
} from "node:http";

import path from "node:path";

import {
    createReadStream,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from "node:fs";

import {
    extname,
} from "node:path";

import {
    spawn,
} from "node:child_process";

import initSqlJs, {
    Database,
    SqlJsStatic,
} from "sql.js";

import {
    pickFile,
    pickFolder,
} from "./native-dialog";

// ============================================================
// CONFIG
// ============================================================

const DEFAULT_PORT = 3131;
const parsedPort = Number.parseInt(
    process.env.PORT ?? "",
    10,
);
const PORT =
    Number.isFinite(parsedPort) &&
    parsedPort > 0
        ? parsedPort
        : DEFAULT_PORT;
const HOST =
    process.env.HOST?.trim() ||
    "127.0.0.1";
const APP_NAME = "merekaipresenter";

const DATA_HOME =
    process.platform === "win32"
        ? (
            process.env.APPDATA ||
            path.join(
                process.env.USERPROFILE ||
                process.cwd(),
                "AppData",
                "Roaming",
            )
        )
        : (
            process.env.XDG_DATA_HOME ||
            path.join(
                process.env.HOME ||
                process.cwd(),
                ".local",
                "share",
            )
        );

const DATA_DIR = path.join(
    DATA_HOME,
    APP_NAME,
);

const DB_PATH = path.join(
    DATA_DIR,
    "settings.db",
);

const PLAYER_DIR = path.join(
    __dirname,
    "../renderer",
);

const PANEL_DIR = path.join(
    __dirname,
    "../../control-panel/dist/control-panel/browser",
);

// ============================================================
// MEDIA
// ============================================================

const IMAGE_REGEX =
    /\.(jpg|jpeg|png|gif|webp)$/i;

const VIDEO_REGEX =
    /\.(mp4|webm)$/i;

const MEDIA_REGEX =
    /\.(jpg|jpeg|png|gif|webp|mp4|webm)$/i;

// ============================================================
// SETTINGS
// ============================================================

const SETTINGS_KEYS = [
    "mediaFolder",
    "slideDurationSeconds",
    "shuffle",
    "volume",
    "fitMode",
    "kenBurns",
    "insertSchedules",
    "insertFiles",
    "insertFile",
    "insertEveryN",
    "insertAfterFolder",
    "insertFolderScope",
    "insertOnLoop",
    "insertHideOverlays",
    "alertFile",
    "alertIntervalSeconds",
    "bodyBackgroundColor",
    "mediaOrder",
    "overlayLayers",
] as const;

type SettingKey =
    (typeof SETTINGS_KEYS)[number];

// ============================================================
// PLAYBACK
// ============================================================

export type PlaybackCommand =
    | "play"
    | "pause"
    | "back"
    | "next"
    | "fast"
    | "slow"
    | "insert"
    | "alert";

export interface PlaybackState {
    current: string | null;
    next: string | null;
    playlist: string[];
    elapsedSeconds: number;
    durationSeconds: number;
    mediaType: "image" | "video" | null;
    index: number;
    total: number;
    isPlaying: boolean;
    playingSpecial: boolean;
    specialPlaybackKind:
        | "insert"
        | "alert"
        | null;
}

let lastPlaybackState: PlaybackState = {
    current: null,
    next: null,
    playlist: [],
    elapsedSeconds: 0,
    durationSeconds: 0,
    mediaType: null,
    index: 0,
    total: 0,
    isPlaying: true,
    playingSpecial: false,
    specialPlaybackKind: null,
};

// ============================================================
// DATABASE
// ============================================================

let db: Database | null = null;

async function initDb(): Promise<void> {
    mkdirSync(DATA_DIR, {
        recursive: true,
    });

    const SQL: SqlJsStatic =
        await initSqlJs();

    try {
        const buffer =
            readFileSync(DB_PATH);

        db = new SQL.Database(buffer);

        console.log(
            `SQLite cargado: ${DB_PATH}`,
        );
    } catch {
        db = new SQL.Database();

        console.log(
            "Creando nueva base de datos SQLite.",
        );
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    saveDb();
}

function saveDb(): void {
    if (!db) {
        throw new Error(
            "Database not initialized",
        );
    }

    mkdirSync(DATA_DIR, {
        recursive: true,
    });

    const data = db.export();

    writeFileSync(
        DB_PATH,
        Buffer.from(data),
    );
}

function getSetting(
    key: string,
): string | null {
    if (!db) {
        throw new Error(
            "Database not initialized",
        );
    }

    const result = db.exec(
        "SELECT value FROM settings WHERE key = ?",
        [key],
    );

    return (
        (result[0]?.values[0]?.[0] as
            | string
            | undefined) ?? null
    );
}

function setSetting(
    key: string,
    value: string,
): void {
    if (!db) {
        throw new Error(
            "Database not initialized",
        );
    }

    db.run(
        `
        INSERT OR REPLACE INTO settings
        (key, value)
        VALUES (?, ?)
        `,
        [key, value],
    );

    saveDb();
}

function getAllSettings(): Record<string, string> {
    const values: Record<string, string> = {};

    for (const key of SETTINGS_KEYS) {
        values[key] =
            getSetting(key) ?? "";
    }

    return values;
}

// ============================================================
// MEDIA WALK
// ============================================================

function walk(
    dir: string,
    base: string,
): string[] {
    if (!existsSync(dir)) {
        return [];
    }

    const entries = readdirSync(
        dir,
        {
            withFileTypes: true,
        },
    ).sort((a, b) =>
        a.name.localeCompare(
            b.name,
            undefined,
            {
                numeric: true,
                sensitivity: "base",
            },
        ),
    );

    const files: string[] = [];

    for (const entry of entries) {
        const fullPath =
            path.join(
                dir,
                entry.name,
            );

        if (entry.isDirectory()) {
            files.push(
                ...walk(
                    fullPath,
                    base,
                ),
            );

            continue;
        }

        if (
            IMAGE_REGEX.test(entry.name) ||
            VIDEO_REGEX.test(entry.name)
        ) {
            const relative =
                fullPath
                    .slice(
                        base.length + 1,
                    )
                    .split(path.sep)
                    .join("/");

            files.push(relative);
        }
    }

    return files;
}

function getMediaFolder(): string {
    return (
        getSetting("mediaFolder") ?? ""
    );
}

function getMediaFiles(
    folder?: string,
): string[] {
    const mediaFolder =
        folder || getMediaFolder();

    if (!mediaFolder) {
        return [];
    }

    try {
        return walk(
            mediaFolder,
            mediaFolder,
        );
    } catch (error) {
        console.error(
            "Error leyendo media:",
            error,
        );

        return [];
    }
}

// ============================================================
// MIME TYPES
// ============================================================

const MIME_TYPES: Record<string, string> = {
    ".html":
        "text/html; charset=utf-8",

    ".js":
        "application/javascript; charset=utf-8",

    ".css":
        "text/css; charset=utf-8",

    ".json":
        "application/json; charset=utf-8",

    ".svg":
        "image/svg+xml",

    ".png":
        "image/png",

    ".jpg":
        "image/jpeg",

    ".jpeg":
        "image/jpeg",

    ".gif":
        "image/gif",

    ".webp":
        "image/webp",

    ".mp4":
        "video/mp4",

    ".webm":
        "video/webm",

    ".ico":
        "image/x-icon",

    ".woff":
        "font/woff",

    ".woff2":
        "font/woff2",
};

// ============================================================
// SSE
// ============================================================

const sseClients =
    new Set<ServerResponse>();

function addSseClient(
    res: ServerResponse,
): void {
    res.writeHead(200, {
        "Content-Type":
            "text/event-stream",

        "Cache-Control":
            "no-cache, no-transform",

        Connection:
            "keep-alive",

        "Access-Control-Allow-Origin":
            "*",

        "X-Accel-Buffering":
            "no",
    });

    res.write(
        `data: ${JSON.stringify({
            type: "connected",
        })}\n\n`,
    );

    sseClients.add(res);

    res.on("close", () => {
        sseClients.delete(res);
    });
}

function broadcast(
    event: Record<string, unknown>,
): void {
    const payload =
        `data: ${JSON.stringify(event)}\n\n`;

    for (const client of sseClients) {
        try {
            client.write(payload);
        } catch {
            sseClients.delete(client);
        }
    }
}

// ============================================================
// JSON
// ============================================================

function readJsonBody<T = unknown>(
    req: IncomingMessage,
): Promise<T> {
    return new Promise(
        (resolve, reject) => {
            let body = "";

            req.on(
                "data",
                (chunk: Buffer) => {
                    body +=
                        chunk.toString();
                },
            );

            req.on(
                "end",
                () => {
                    if (!body) {
                        resolve(
                            undefined as T,
                        );

                        return;
                    }

                    try {
                        resolve(
                            JSON.parse(body) as T,
                        );
                    } catch (error) {
                        reject(error);
                    }
                },
            );

            req.on(
                "error",
                reject,
            );
        },
    );
}

function sendJson(
    res: ServerResponse,
    data: unknown,
    statusCode = 200,
): void {
    const json =
        JSON.stringify(data);

    res.writeHead(
        statusCode,
        {
            "Content-Type":
                "application/json; charset=utf-8",

            "Cache-Control":
                "no-cache",
        },
    );

    res.end(json);
}

function sendError(
    res: ServerResponse,
    statusCode: number,
    message: string,
): void {
    sendJson(
        res,
        {
            error: message,
        },
        statusCode,
    );
}

// ============================================================
// PATH SECURITY
// ============================================================

function isPathInside(
    parent: string,
    target: string,
): boolean {
    const relative =
        path.relative(
            parent,
            target,
        );

    return (
        relative === "" ||
        (
            !relative.startsWith("..") &&
            !path.isAbsolute(relative)
        )
    );
}

// ============================================================
// SERVE MEDIA
// ============================================================

function serveMedia(
    req: IncomingMessage,
    res: ServerResponse,
    relativePath: string,
): void {
    const mediaFolder =
        getMediaFolder();

    if (!mediaFolder) {
        sendError(
            res,
            404,
            "No media folder configured",
        );

        return;
    }

    let decodedPath: string;

    try {
        decodedPath =
            decodeURIComponent(
                relativePath,
            );
    } catch {
        sendError(
            res,
            400,
            "Invalid media path",
        );

        return;
    }

    const safeRelative =
        decodedPath.replace(
            /^[/\\]+/,
            "",
        );

    const absolutePath =
        path.resolve(
            mediaFolder,
            safeRelative,
        );

    const rootPath =
        path.resolve(mediaFolder);

    if (
        !isPathInside(
            rootPath,
            absolutePath,
        )
    ) {
        sendError(
            res,
            403,
            "Forbidden",
        );

        return;
    }

    serveMediaFile(
        req,
        res,
        absolutePath,
    );
}

function serveMediaFile(
    req: IncomingMessage,
    res: ServerResponse,
    absolutePath: string,
): void {
    if (!existsSync(absolutePath)) {
        sendError(
            res,
            404,
            "Media not found",
        );

        return;
    }

    let stats;

    try {
        stats =
            statSync(absolutePath);
    } catch {
        sendError(
            res,
            404,
            "Media not found",
        );

        return;
    }

    if (!stats.isFile()) {
        sendError(
            res,
            404,
            "Not a file",
        );

        return;
    }

    if (
        !MEDIA_REGEX.test(
            absolutePath,
        )
    ) {
        sendError(
            res,
            403,
            "Unsupported media type",
        );

        return;
    }

    const ext =
        extname(
            absolutePath,
        ).toLowerCase();

    const contentType =
        MIME_TYPES[ext] ??
        "application/octet-stream";

    const totalSize =
        stats.size;

    if (req.method === "HEAD") {
        res.writeHead(
            200,
            {
                "Content-Type":
                    contentType,

                "Content-Length":
                    totalSize,

                "Accept-Ranges":
                    "bytes",

                "Cache-Control":
                    "no-cache",
            },
        );

        res.end();

        return;
    }

    const range =
        req.headers.range;

    if (range) {
        const match =
            /^bytes=(\d*)-(\d*)$/.exec(
                range,
            );

        if (!match) {
            res.writeHead(416);
            res.end();
            return;
        }

        let start: number;
        let end: number;

        if (match[1]) {
            start =
                Number(match[1]);
        } else {
            const suffixLength =
                Number(match[2]);

            start =
                Math.max(
                    0,
                    totalSize -
                        suffixLength,
                );
        }

        if (match[2]) {
            end =
                Number(match[2]);
        } else {
            end =
                totalSize - 1;
        }

        if (
            start >= totalSize ||
            end >= totalSize ||
            start > end
        ) {
            res.writeHead(
                416,
                {
                    "Content-Range":
                        `bytes */${totalSize}`,
                },
            );

            res.end();

            return;
        }

        const chunkSize =
            end - start + 1;

        res.writeHead(
            206,
            {
                "Content-Type":
                    contentType,

                "Content-Length":
                    chunkSize,

                "Content-Range":
                    `bytes ${start}-${end}/${totalSize}`,

                "Accept-Ranges":
                    "bytes",

                "Cache-Control":
                    "no-cache",
            },
        );

        createReadStream(
            absolutePath,
            {
                start,
                end,
            },
        ).pipe(res);

        return;
    }

    res.writeHead(
        200,
        {
            "Content-Type":
                contentType,

            "Content-Length":
                totalSize,

            "Accept-Ranges":
                "bytes",

            "Cache-Control":
                "no-cache",
        },
    );

    createReadStream(
        absolutePath,
    ).pipe(res);
}

// ============================================================
// STATIC FILES
// ============================================================

function serveStaticFile(
    res: ServerResponse,
    rootDir: string,
    pathname: string,
): void {
    let decodedPath: string;

    try {
        decodedPath =
            decodeURIComponent(
                pathname,
            );
    } catch {
        sendError(
            res,
            400,
            "Invalid URL",
        );

        return;
    }

    const relativePath =
        decodedPath.replace(
            /^[/\\]+/,
            "",
        );

    const root =
        path.resolve(rootDir);

    let filePath =
        path.resolve(
            root,
            relativePath,
        );

    if (
        !isPathInside(
            root,
            filePath,
        )
    ) {
        sendError(
            res,
            403,
            "Forbidden",
        );

        return;
    }

    if (
        !existsSync(filePath) ||
        !statSync(filePath).isFile()
    ) {
        filePath =
            path.join(
                root,
                "index.html",
            );
    }

    if (
        !existsSync(filePath) ||
        !statSync(filePath).isFile()
    ) {
        sendError(
            res,
            503,
            "Static application not built",
        );

        return;
    }

    const contentType =
        MIME_TYPES[
            extname(filePath).toLowerCase()
        ] ??
        "application/octet-stream";

    res.writeHead(
        200,
        {
            "Content-Type":
                contentType,

            "Cache-Control":
                "no-cache",
        },
    );

    if (
        filePath.endsWith(
            "index.html",
        )
    ) {
        res.end(
            readFileSync(filePath),
        );

        return;
    }

    createReadStream(
        filePath,
    ).pipe(res);
}

// ============================================================
// API
// ============================================================

const PLAYBACK_COMMANDS:
    ReadonlySet<string> =
    new Set([
        "play",
        "pause",
        "back",
        "next",
        "fast",
        "slow",
        "insert",
        "alert",
    ]);

function isPlaybackCommand(
    value: unknown,
): value is PlaybackCommand {
    return (
        typeof value === "string" &&
        PLAYBACK_COMMANDS.has(value)
    );
}

function normalizePlaybackState(
    value: unknown,
): PlaybackState {
    const state =
        typeof value === "object" &&
        value !== null
            ? value as Record<string, unknown>
            : {};

    const specialKind =
        state.specialPlaybackKind;

    return {
        current:
            typeof state.current === "string"
                ? state.current
                : null,

        next:
            typeof state.next === "string"
                ? state.next
                : null,

        playlist:
            Array.isArray(state.playlist)
                ? state.playlist.filter(
                    (item): item is string =>
                        typeof item === "string",
                )
                : [],

        elapsedSeconds:
            typeof state.elapsedSeconds === "number" &&
            Number.isFinite(state.elapsedSeconds) &&
            state.elapsedSeconds >= 0
                ? state.elapsedSeconds
                : 0,

        durationSeconds:
            typeof state.durationSeconds === "number" &&
            Number.isFinite(state.durationSeconds) &&
            state.durationSeconds >= 0
                ? state.durationSeconds
                : 0,

        mediaType:
            state.mediaType === "image" ||
            state.mediaType === "video"
                ? state.mediaType
                : null,

        index:
            typeof state.index === "number" &&
            Number.isFinite(state.index)
                ? state.index
                : 0,

        total:
            typeof state.total === "number" &&
            Number.isFinite(state.total)
                ? state.total
                : 0,

        isPlaying:
            typeof state.isPlaying === "boolean"
                ? state.isPlaying
                : false,

        playingSpecial:
            typeof state.playingSpecial === "boolean"
                ? state.playingSpecial
                : false,

        specialPlaybackKind:
            specialKind === "insert" ||
            specialKind === "alert"
                ? specialKind
                : null,
    };
}

async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    requestUrl: URL,
): Promise<boolean> {

    // --------------------------------------------------------
    // SSE
    // --------------------------------------------------------

    if (
        pathname === "/api/events" &&
        req.method === "GET"
    ) {
        addSseClient(res);
        return true;
    }

    // --------------------------------------------------------
    // SETTINGS GET
    // --------------------------------------------------------

    if (
        pathname === "/api/settings" &&
        req.method === "GET"
    ) {
        sendJson(
            res,
            getAllSettings(),
        );

        return true;
    }

    // --------------------------------------------------------
    // SETTINGS POST
    // --------------------------------------------------------

    if (
        pathname === "/api/settings" &&
        req.method === "POST"
    ) {
        try {
            const body =
                await readJsonBody<
                    Record<string, unknown>
                >(req);

            for (const key of SETTINGS_KEYS) {
                if (
                    typeof body?.[key] ===
                    "string"
                ) {
                    setSetting(
                        key,
                        body[key] as string,
                    );
                }
            }

            broadcast({
                type: "settings-changed",
            });

            sendJson(
                res,
                {
                    ok: true,
                },
            );
        } catch (error) {
            console.error(
                "Error guardando settings:",
                error,
            );

            sendError(
                res,
                400,
                "Invalid settings",
            );
        }

        return true;
    }

    // --------------------------------------------------------
    // MEDIA
    // --------------------------------------------------------

    if (
        pathname === "/api/media" &&
        req.method === "GET"
    ) {
        const requestedFolder =
            requestUrl.searchParams.get(
                "folder",
            );

        const folder =
            requestedFolder ||
            getMediaFolder();

        const files =
            getMediaFiles(folder);

        sendJson(
            res,
            {
                folder,
                files,
            },
        );

        return true;
    }

    // --------------------------------------------------------
    // LOCAL FILE
    // --------------------------------------------------------

    if (
        pathname ===
            "/api/local-file" &&
        req.method === "GET"
    ) {
        const requestedPath =
            requestUrl.searchParams.get(
                "path",
            );

        if (!requestedPath) {
            sendError(
                res,
                400,
                "Missing file path",
            );

            return true;
        }

        const absolutePath =
            path.resolve(
                requestedPath,
            );

        if (
            !path.isAbsolute(
                absolutePath,
            )
        ) {
            sendError(
                res,
                400,
                "Invalid file path",
            );

            return true;
        }

        const mediaFolder =
            getMediaFolder();

        if (!mediaFolder) {
            sendError(
                res,
                404,
                "No media folder configured",
            );

            return true;
        }

        if (
            !isPathInside(
                path.resolve(mediaFolder),
                absolutePath,
            )
        ) {
            sendError(
                res,
                403,
                "Forbidden",
            );

            return true;
        }

        serveMediaFile(
            req,
            res,
            absolutePath,
        );

        return true;
    }

    // --------------------------------------------------------
    // MEDIA ORDER GET
    // --------------------------------------------------------

    if (
        pathname === "/api/media-order" &&
        req.method === "GET"
    ) {
        const folder =
            getMediaFolder();

        const files =
            getMediaFiles(folder);

        let order: string[] = [];

        try {
            const parsed =
                JSON.parse(
                    getSetting(
                        "mediaOrder",
                    ) ?? "[]",
                );

            if (Array.isArray(parsed)) {
                order =
                    parsed.filter(
                        (
                            value,
                        ): value is string =>
                            typeof value ===
                            "string",
                    );
            }
        } catch {
            order = [];
        }

        sendJson(
            res,
            {
                files,
                order,
            },
        );

        return true;
    }

    // --------------------------------------------------------
    // MEDIA ORDER POST
    // --------------------------------------------------------

    if (
        pathname === "/api/media-order" &&
        req.method === "POST"
    ) {
        try {
            const order =
                await readJsonBody<unknown>(
                    req,
                );

            const value =
                Array.isArray(order)
                    ? order.filter(
                        (
                            item,
                        ): item is string =>
                            typeof item ===
                            "string",
                    )
                    : [];

            setSetting(
                "mediaOrder",
                JSON.stringify(value),
            );

            broadcast({
                type: "settings-changed",
            });

            sendJson(
                res,
                {
                    ok: true,
                },
            );
        } catch (error) {
            console.error(
                "Error guardando mediaOrder:",
                error,
            );

            sendError(
                res,
                400,
                "Invalid media order",
            );
        }

        return true;
    }

    // --------------------------------------------------------
    // OVERLAYS GET
    // --------------------------------------------------------

    if (
        pathname === "/api/overlays" &&
        req.method === "GET"
    ) {
        let overlays: unknown[] = [];

        try {
            const parsed =
                JSON.parse(
                    getSetting(
                        "overlayLayers",
                    ) ?? "[]",
                );

            if (Array.isArray(parsed)) {
                overlays = parsed;
            }
        } catch {
            overlays = [];
        }

        sendJson(
            res,
            overlays,
        );

        return true;
    }

    // --------------------------------------------------------
    // OVERLAYS POST
    // --------------------------------------------------------

    if (
        pathname === "/api/overlays" &&
        req.method === "POST"
    ) {
        try {
            const layers =
                await readJsonBody<unknown>(
                    req,
                );

            setSetting(
                "overlayLayers",
                JSON.stringify(
                    Array.isArray(layers)
                        ? layers
                        : [],
                ),
            );

            broadcast({
                type: "settings-changed",
            });

            sendJson(
                res,
                {
                    ok: true,
                },
            );
        } catch (error) {
            console.error(
                "Error guardando overlays:",
                error,
            );

            sendError(
                res,
                400,
                "Invalid overlays",
            );
        }

        return true;
    }

    // --------------------------------------------------------
    // PLAYLIST
    // --------------------------------------------------------

    if (
        pathname === "/api/playlist" &&
        req.method === "GET"
    ) {
        sendJson(
            res,
            lastPlaybackState,
        );

        return true;
    }

    // --------------------------------------------------------
    // PLAYBACK STATE
    // --------------------------------------------------------

    if (
        pathname === "/api/playback-state" &&
        req.method === "POST"
    ) {
        try {
            const body =
                await readJsonBody<unknown>(
                    req,
                );

            lastPlaybackState =
                normalizePlaybackState(body);

            broadcast({
                type: "playback-state",
                state: lastPlaybackState,
            });

            sendJson(
                res,
                {
                    ok: true,
                },
            );
        } catch (error) {
            console.error(
                "Error en playback-state:",
                error,
            );

            sendError(
                res,
                400,
                "Invalid playback state",
            );
        }

        return true;
    }

    // --------------------------------------------------------
    // PLAYBACK COMMAND
    // --------------------------------------------------------

    if (
        pathname === "/api/playback-command" &&
        req.method === "POST"
    ) {
        try {
            const body =
                await readJsonBody<{
                    command?: unknown;
                    index?: unknown;
                }>(req);

            if (
                !isPlaybackCommand(
                    body?.command,
                )
            ) {
                sendError(
                    res,
                    400,
                    "Invalid playback command",
                );

                return true;
            }

            const index =
                body.index === undefined
                    ? undefined
                    : typeof body.index === "number" &&
                        Number.isInteger(body.index) &&
                        body.index >= 0
                        ? body.index
                        : null;

            if (index === null) {
                sendError(
                    res,
                    400,
                    "Invalid playback index",
                );

                return true;
            }

            broadcast({
                type: "playback-command",
                command: body.command,
                ...(index === undefined ? {} : { index }),
            });

            sendJson(
                res,
                {
                    ok: true,
                },
            );
        } catch (error) {
            console.error(
                "Error en playback-command:",
                error,
            );

            sendError(
                res,
                400,
                "Invalid request",
            );
        }

        return true;
    }

    // --------------------------------------------------------
    // SET MEDIA FOLDER
    // --------------------------------------------------------

    if (
        pathname === "/api/set-media-folder" &&
        req.method === "POST"
    ) {
        try {
            const body =
                await readJsonBody<{
                    folder?: unknown;
                }>(req);

            if (
                typeof body?.folder !==
                "string"
            ) {
                sendError(
                    res,
                    400,
                    "Invalid folder",
                );

                return true;
            }

            const folder =
                body.folder.trim();

            if (!folder) {
                sendError(
                    res,
                    400,
                    "Folder is empty",
                );

                return true;
            }

            if (!existsSync(folder)) {
                sendError(
                    res,
                    400,
                    "Folder does not exist",
                );

                return true;
            }

            if (
                !statSync(folder).isDirectory()
            ) {
                sendError(
                    res,
                    400,
                    "Path is not a directory",
                );

                return true;
            }

            setSetting(
                "mediaFolder",
                folder,
            );

            broadcast({
                type: "settings-changed",
            });

            sendJson(
                res,
                {
                    ok: true,
                    folder,
                },
            );
        } catch (error) {
            console.error(
                "Error configurando mediaFolder:",
                error,
            );

            sendError(
                res,
                400,
                "Invalid media folder",
            );
        }

        return true;
    }

    // --------------------------------------------------------
    // PICK FOLDER
    // --------------------------------------------------------

    if (
        pathname === "/api/pick-folder" &&
        req.method === "POST"
    ) {
        try {
            const selected =
                await pickFolder();

            sendJson(
                res,
                {
                    path: selected,
                },
            );
        } catch (error) {
            console.error(
                "Error abriendo selector de carpeta:",
                error,
            );

            sendError(
                res,
                500,
                "Unable to open folder picker",
            );
        }

        return true;
    }

    // --------------------------------------------------------
    // PICK FILE
    // --------------------------------------------------------

    if (
        pathname === "/api/pick-file" &&
        req.method === "POST"
    ) {
        try {
            const selected =
                await pickFile();

            sendJson(
                res,
                {
                    path: selected,
                },
            );
        } catch (error) {
            console.error(
                "Error abriendo selector de archivo:",
                error,
            );

            sendError(
                res,
                500,
                "Unable to open file picker",
            );
        }

        return true;
    }

    return false;
}

// ============================================================
// HTTP SERVER
// ============================================================

function startServer(): void {
    const server =
        http.createServer(
            async (
                req,
                res,
            ) => {
                try {
                    const requestUrl =
                        new URL(
                            req.url ?? "/",
                            `http://${HOST}:${PORT}`,
                        );

                    const pathname =
                        requestUrl.pathname;

                    // ------------------------------------------------
                    // MEDIA
                    // ------------------------------------------------

                    if (
                        pathname.startsWith(
                            "/media/",
                        )
                    ) {
                        if (
                            req.method !== "GET" &&
                            req.method !== "HEAD"
                        ) {
                            sendError(
                                res,
                                405,
                                "Method not allowed",
                            );

                            return;
                        }

                        const relativePath =
                            pathname.slice(
                                "/media/".length,
                            );

                        serveMedia(
                            req,
                            res,
                            relativePath,
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // PLAYER
                    // ------------------------------------------------

                    if (
                        pathname === "/player"
                    ) {
                        res.writeHead(
                            302,
                            {
                                Location:
                                    "/player/",
                            },
                        );

                        res.end();

                        return;
                    }

                    if (
                        pathname.startsWith(
                            "/player/",
                        )
                    ) {
                        if (
                            req.method !== "GET"
                        ) {
                            sendError(
                                res,
                                405,
                                "Method not allowed",
                            );

                            return;
                        }

                        const playerPath =
                            pathname.slice(
                                "/player/".length,
                            );

                        serveStaticFile(
                            res,
                            PLAYER_DIR,
                            playerPath
                                ? `/${playerPath}`
                                : "/index.html",
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // API
                    // ------------------------------------------------

                    if (
                        pathname.startsWith(
                            "/api/",
                        )
                    ) {
                        const handled =
                            await handleApi(
                                req,
                                res,
                                pathname,
                                requestUrl,
                            );

                        if (!handled) {
                            sendError(
                                res,
                                404,
                                "API endpoint not found",
                            );
                        }

                        return;
                    }

                    // ------------------------------------------------
                    // CONTROL PANEL
                    // ------------------------------------------------

                    if (
                        req.method !== "GET"
                    ) {
                        sendError(
                            res,
                            405,
                            "Method not allowed",
                        );

                        return;
                    }

                    serveStaticFile(
                        res,
                        PANEL_DIR,
                        pathname,
                    );
                } catch (error) {
                    console.error(
                        "HTTP error:",
                        error,
                    );

                    if (!res.headersSent) {
                        sendError(
                            res,
                            500,
                            "Internal server error",
                        );
                    } else {
                        res.end();
                    }
                }
            },
        );

    server.on(
        "error",
        (error: NodeJS.ErrnoException) => {
            if (
                error.code ===
                "EADDRINUSE"
            ) {
                console.error(
                    `Port ${PORT} is already in use on ${HOST}. ` +
                        "Stop the other instance or set PORT to a different value.",
                );
            } else {
                console.error(
                    "HTTP server failed:",
                    error,
                );
            }

            process.exit(1);
        },
    );

    server.listen(
        PORT,
        HOST,
        () => {
            console.log("");

            console.log(
                "========================================",
            );

            console.log(
                " MerekaiGallery",
            );

            console.log(
                "========================================",
            );

            console.log(
                `Control panel: http://${HOST}:${PORT}/`,
            );

            console.log(
                `Player:        http://${HOST}:${PORT}/player/`,
            );

            console.log(
                `SSE:           http://${HOST}:${PORT}/api/events`,
            );

            console.log(
                `Database:      ${DB_PATH}`,
            );

            console.log(
                `Media folder:  ${
                    getMediaFolder() ||
                    "(not configured)"
                }`,
            );

            console.log(
                `Platform:      ${process.platform}`,
            );

            console.log(
                "========================================",
            );

            console.log("");
        },
    );

    // ------------------------------------------------------------
    // SSE heartbeat
    // ------------------------------------------------------------

    setInterval(
        () => {
            for (
                const client of sseClients
            ) {
                try {
                    client.write(
                        ": heartbeat\n\n",
                    );
                } catch {
                    sseClients.delete(
                        client,
                    );
                }
            }
        },
        25_000,
    );
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
    try {
        await initDb();
        startServer();
    } catch (error) {
        console.error(
            "No se pudo iniciar MerekaiGallery:",
            error,
        );

        process.exit(1);
    }
}

void main();