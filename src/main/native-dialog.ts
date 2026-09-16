"use strict";

import {
    execFile,
} from "node:child_process";

import {
    promisify,
} from "node:util";

const execFileAsync = promisify(execFile);

async function commandExists(
    command: string,
): Promise<boolean> {
    try {
        const checker =
            process.platform === "win32"
                ? "where.exe"
                : "which";

        await execFileAsync(
            checker,
            [command],
            {
                windowsHide: true,
            },
        );

        return true;
    } catch {
        return false;
    }
}

function cleanDialogResult(
    value: string,
): string | null {
    const result = value
        .replace(/\r/g, "")
        .trim();

    return result || null;
}

// ============================================================
// WINDOWS
// ============================================================

async function pickFolderWindows(): Promise<string | null> {
    const script = `
Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select media folder"
$dialog.ShowNewFolderButton = $true

$result = $dialog.ShowDialog()

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write($dialog.SelectedPath)
}
`;

    try {
        const { stdout } =
            await execFileAsync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-STA",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    script,
                ],
                {
                    windowsHide: false,
                    maxBuffer: 1024 * 1024,
                },
            );

        return cleanDialogResult(stdout);
    } catch (error) {
        console.error(
            "Windows folder picker error:",
            error,
        );

        return null;
    }
}

async function pickFileWindows(): Promise<string | null> {
    const script = `
Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select media file"
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.Filter = "Media files|*.jpg;*.jpeg;*.png;*.gif;*.webp;*.mp4;*.webm|All files|*.*"

$result = $dialog.ShowDialog()

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write($dialog.FileName)
}
`;

    try {
        const { stdout } =
            await execFileAsync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-STA",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    script,
                ],
                {
                    windowsHide: false,
                    maxBuffer: 1024 * 1024,
                },
            );

        return cleanDialogResult(stdout);
    } catch (error) {
        console.error(
            "Windows file picker error:",
            error,
        );

        return null;
    }
}

// ============================================================
// LINUX / RASPBERRY PI
// ============================================================

async function pickFolderZenity(): Promise<string | null> {
    try {
        const { stdout } =
            await execFileAsync(
                "zenity",
                [
                    "--file-selection",
                    "--directory",
                    "--title=Select media folder",
                ],
                {
                    maxBuffer: 1024 * 1024,
                },
            );

        return cleanDialogResult(stdout);
    } catch {
        return null;
    }
}

async function pickFileZenity(): Promise<string | null> {
    try {
        const { stdout } =
            await execFileAsync(
                "zenity",
                [
                    "--file-selection",
                    "--title=Select media file",
                    "--file-filter=Media files | *.jpg *.jpeg *.png *.gif *.webp *.mp4 *.webm",
                    "--file-filter=All files | *",
                ],
                {
                    maxBuffer: 1024 * 1024,
                },
            );

        return cleanDialogResult(stdout);
    } catch {
        return null;
    }
}

async function pickFolderKdialog(): Promise<string | null> {
    try {
        const { stdout } =
            await execFileAsync(
                "kdialog",
                [
                    "--getexistingdirectory",
                    "",
                    "--title",
                    "Select media folder",
                ],
                {
                    maxBuffer: 1024 * 1024,
                },
            );

        return cleanDialogResult(stdout);
    } catch {
        return null;
    }
}

async function pickFileKdialog(): Promise<string | null> {
    try {
        const { stdout } =
            await execFileAsync(
                "kdialog",
                [
                    "--getopenfilename",
                    "",
                    "*.jpg *.jpeg *.png *.gif *.webp *.mp4 *.webm",
                    "--title",
                    "Select media file",
                ],
                {
                    maxBuffer: 1024 * 1024,
                },
            );

        return cleanDialogResult(stdout);
    } catch {
        return null;
    }
}

async function pickFolderYad(): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(
            "yad",
            ["--file-selection", "--directory", "--title=Select media folder"],
            { maxBuffer: 1024 * 1024 },
        );
        return cleanDialogResult(stdout);
    } catch {
        return null;
    }
}

async function pickFileYad(): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(
            "yad",
            [
                "--file-selection",
                "--title=Select media file",
                "--file-filter=Media files: *.jpg *.jpeg *.png *.gif *.webp *.mp4 *.webm",
                "--file-filter=All files: *",
            ],
            { maxBuffer: 1024 * 1024 },
        );
        return cleanDialogResult(stdout);
    } catch {
        return null;
    }
}

async function pickFolderPython(): Promise<string | null> {
    const script = `
import tkinter as tk
from tkinter import filedialog
root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)
print(filedialog.askdirectory(title="Select media folder"))
root.destroy()
`;

    try {
        const { stdout } = await execFileAsync("python3", ["-c", script], {
            maxBuffer: 1024 * 1024,
        });
        return cleanDialogResult(stdout);
    } catch {
        return null;
    }
}

async function pickFilePython(): Promise<string | null> {
    const script = `
import tkinter as tk
from tkinter import filedialog
root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)
print(filedialog.askopenfilename(title="Select media file", filetypes=[("Media files", "*.jpg *.jpeg *.png *.gif *.webp *.mp4 *.webm"), ("All files", "*")]))
root.destroy()
`;

    try {
        const { stdout } = await execFileAsync("python3", ["-c", script], {
            maxBuffer: 1024 * 1024,
        });
        return cleanDialogResult(stdout);
    } catch {
        return null;
    }
}

// ============================================================
// PUBLIC API
// ============================================================

export async function pickFolder(): Promise<string | null> {
    if (process.platform === "win32") {
        return pickFolderWindows();
    }

    if (await commandExists("zenity")) {
        const result =
            await pickFolderZenity();

        if (result) {
            return result;
        }
    }

    if (await commandExists("kdialog")) {
        const result = await pickFolderKdialog();
        if (result) {
            return result;
        }
    }

    if (await commandExists("yad")) {
        const result = await pickFolderYad();
        if (result) {
            return result;
        }
    }

    if (await commandExists("python3")) {
        const result = await pickFolderPython();
        if (result) {
            return result;
        }
    }

    console.error(
        "No native folder picker available. Install zenity, yad, kdialog, or python3-tk.",
    );

    return null;
}

export async function pickFile(): Promise<string | null> {
    if (process.platform === "win32") {
        return pickFileWindows();
    }

    if (await commandExists("zenity")) {
        const result =
            await pickFileZenity();

        if (result) {
            return result;
        }
    }

    if (await commandExists("kdialog")) {
        const result = await pickFileKdialog();
        if (result) {
            return result;
        }
    }

    if (await commandExists("yad")) {
        const result = await pickFileYad();
        if (result) {
            return result;
        }
    }

    if (await commandExists("python3")) {
        const result = await pickFilePython();
        if (result) {
            return result;
        }
    }

    console.error(
        "No native file picker available. Install zenity, yad, kdialog, or python3-tk.",
    );

    return null;
}