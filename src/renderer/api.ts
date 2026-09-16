"use strict";

// ============================================================
// TYPES
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
    current?: string | null;
    next?: string | null;
    index?: number;
    total?: number;
    isPlaying?: boolean;
    playingSpecial?: boolean;
    specialPlaybackKind?:
        | "insert"
        | "alert"
        | null;
}

type SettingsEvent = {
    type: "settings-changed";
};

type PlaybackCommandEvent = {
    type: "playback-command";
    command: PlaybackCommand;
    index?: number;
};

type PlaybackStateEvent = {
    type: "playback-state";
    state: PlaybackState;
};

type ConnectedEvent = {
    type: "connected";
};

type ServerEvent =
    | SettingsEvent
    | PlaybackCommandEvent
    | PlaybackStateEvent
    | ConnectedEvent;

// ============================================================
// HTTP HELPERS
// ============================================================

async function requestJson<T>(
    url: string,
    options?: RequestInit,
): Promise<T> {
    const response =
        await fetch(
            url,
            options,
        );

    if (!response.ok) {
        let message =
            `${response.status} ${response.statusText}`;

        try {
            const error =
                (await response.json()) as {
                    error?: unknown;
                };

            if (
                typeof error.error ===
                "string"
            ) {
                message =
                    `${response.status}: ${error.error}`;
            }
        } catch {
            // La respuesta puede no ser JSON.
        }

        throw new Error(message);
    }

    return (
        await response.json()
    ) as T;
}

// ============================================================
// SETTINGS CACHE
// ============================================================

let settingsCache:
    | Record<string, string>
    | null = null;

async function loadSettings(
    force = false,
): Promise<Record<string, string>> {
    if (
        !force &&
        settingsCache !== null
    ) {
        return settingsCache;
    }

    const settings =
        await requestJson<
            Record<string, string>
        >("/api/settings");

    settingsCache =
        settings;

    return settings;
}

// ============================================================
// SSE
// ============================================================

let eventSource:
    | EventSource
    | null = null;

const settingsListeners =
    new Set<() => void>();

const playbackListeners =
    new Set<
        (
            command: PlaybackCommand,
            index?: number,
        ) => void
    >();

function ensureEventSource(): void {
    if (eventSource) {
        return;
    }

    const source =
        new EventSource(
            "/api/events",
        );

    eventSource =
        source;

    source.onmessage =
        (event: MessageEvent<string>) => {
            try {
                const payload =
                    JSON.parse(
                        event.data,
                    ) as ServerEvent;

                switch (
                    payload.type
                ) {
                    case "connected": {
                        console.log(
                            "SSE conectado.",
                        );

                        break;
                    }

                    case "settings-changed": {
                        settingsCache =
                            null;

                        for (
                            const listener of settingsListeners
                        ) {
                            try {
                                listener();
                            } catch (
                                error
                            ) {
                                console.warn(
                                    "Error en settings listener:",
                                    error,
                                );
                            }
                        }

                        break;
                    }

                    case "playback-command": {
                        for (
                            const listener of playbackListeners
                        ) {
                            try {
                                listener(
                                    payload.command,
                                    payload.index,
                                );
                            } catch (
                                error
                            ) {
                                console.warn(
                                    "Error en playback listener:",
                                    error,
                                );
                            }
                        }

                        break;
                    }

                    case "playback-state": {
                        /*
                         * Actualmente el player envía
                         * el estado al servidor.
                         *
                         * Este evento queda soportado
                         * para futuras extensiones.
                         */
                        void payload.state;

                        break;
                    }
                }
            } catch (
                error
            ) {
                console.warn(
                    "SSE: evento inválido:",
                    error,
                );
            }
        };

    source.onerror =
        () => {
            /*
             * EventSource realiza la reconexión
             * automáticamente.
             */
            console.warn(
                "SSE: conexión perdida; esperando reconexión...",
            );
        };
}

function closeEventSourceIfUnused(): void {
    if (
        settingsListeners.size > 0 ||
        playbackListeners.size > 0
    ) {
        return;
    }

    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
}

// ============================================================
// PUBLIC API
// ============================================================

export const api = {

    // ========================================================
    // SETTINGS
    // ========================================================

    async getSetting(
        key: string,
    ): Promise<string | null> {
        const settings =
            await loadSettings();

        return (
            settings[key] ??
            null
        );
    },

    async setSetting(
        key: string,
        value: string,
    ): Promise<void> {
        await requestJson<{
            ok: boolean;
        }>("/api/settings", {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json",
            },

            body: JSON.stringify({
                [key]: value,
            }),
        });

        if (
            settingsCache !== null
        ) {
            settingsCache[key] =
                value;
        }
    },

    // ========================================================
    // MEDIA
    // ========================================================

    async listMedia(
        folder?: string,
    ): Promise<string[]> {
        const query =
            folder
                ? `?folder=${encodeURIComponent(
                    folder,
                )}`
                : "";

        const data =
            await requestJson<{
                folder: string;
                files: string[];
            }>(
                `/api/media${query}`,
            );

        return Array.isArray(
            data.files,
        )
            ? data.files
            : [];
    },

    // ========================================================
    // PLAYBACK STATE
    // ========================================================

    async sendPlaybackState(
        state: PlaybackState,
    ): Promise<void> {
        await requestJson<{
            ok: boolean;
        }>("/api/playback-state", {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json",
            },

            body: JSON.stringify(
                state,
            ),
        });
    },

    // ========================================================
    // PLAYBACK COMMAND
    // ========================================================

    async sendPlaybackCommand(
        command: PlaybackCommand,
    ): Promise<void> {
        await requestJson<{
            ok: boolean;
        }>("/api/playback-command", {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json",
            },

            body: JSON.stringify({
                command,
            }),
        });
    },

    // ========================================================
    // PICK FOLDER
    // ========================================================

    async pickFolder(): Promise<
        string | null
    > {
        const data =
            await requestJson<{
                path?: string | null;
            }>("/api/pick-folder", {
                method: "POST",
            });

        return (
            data.path ??
            null
        );
    },

    // ========================================================
    // SET MEDIA FOLDER
    // ========================================================

    async setMediaFolder(
        folder: string,
    ): Promise<void> {
        await requestJson<{
            ok: boolean;
            folder: string;
        }>("/api/set-media-folder", {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json",
            },

            body: JSON.stringify({
                folder,
            }),
        });

        if (
            settingsCache !== null
        ) {
            settingsCache.mediaFolder =
                folder;
        }
    },

    // ========================================================
    // PICK FILE
    // ========================================================

    async pickFile(): Promise<
        string | null
    > {
        const data =
            await requestJson<{
                path?: string | null;
            }>("/api/pick-file", {
                method: "POST",
            });

        return (
            data.path ??
            null
        );
    },

    // ========================================================
    // SETTINGS SSE
    // ========================================================

    onSettingsChanged(
        callback: () => void,
    ): () => void {
        settingsListeners.add(
            callback,
        );

        ensureEventSource();

        return () => {
            settingsListeners.delete(
                callback,
            );

            closeEventSourceIfUnused();
        };
    },

    // ========================================================
    // PLAYBACK COMMAND SSE
    // ========================================================

    onPlaybackCommand(
        callback: (
            command: PlaybackCommand,
            index?: number,
        ) => void,
    ): () => void {
        playbackListeners.add(
            callback,
        );

        ensureEventSource();

        return () => {
            playbackListeners.delete(
                callback,
            );

            closeEventSourceIfUnused();
        };
    },
};