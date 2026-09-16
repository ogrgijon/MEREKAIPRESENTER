import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface OverlayLayer {
  id: string;
  template: string;
  css: string;
  enabled: boolean;
  type?: 'text' | 'bar' | 'square' | 'circle' | 'image' | 'drawing';
  source?: string;
  fit?: 'contain' | 'cover';
  pathData?: string;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
}

export interface MediaOrderResponse {
  files: string[];
  order: string[];
  hidden: string[];
}

export interface PlaybackState {
  current: string | null;
  next: string | null;
  playlist: string[];
  elapsedSeconds: number;
  durationSeconds: number;
  mediaType: 'image' | 'video' | null;
  index: number;
  total: number;
  isPlaying: boolean;
  playingSpecial: boolean;
  specialPlaybackKind: 'insert' | 'alert' | null;
}

export type PlaybackCommand = 'play' | 'pause' | 'back' | 'next' | 'fast' | 'slow' | 'insert' | 'alert';

export interface UploadResponse {
  ok: boolean;
  uploaded: string[];
  rejected: string[];
}

export interface FileBrowserEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
}

export interface FileBrowserResponse {
  path: string | null;
  entries: FileBrowserEntry[];
}

// Talks to the local Node http server that hosts both the control panel and the player.
@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  getSettings(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>('/api/settings');
  }

  saveSettings(settings: Record<string, string>): Observable<void> {
    return this.http.post<void>('/api/settings', settings);
  }

  saveAuthentication(username: string, password: string, enabled: boolean): Observable<{ ok: boolean; enabled: boolean; username?: string }> {
    return this.http.post<{ ok: boolean; enabled: boolean; username?: string }>('/api/auth', { username, password, enabled });
  }

  getMediaOrder(): Observable<MediaOrderResponse> {
    return this.http.get<MediaOrderResponse>('/api/media-order');
  }

  saveMediaOrder(order: string[], hidden: string[]): Observable<void> {
    return this.http.post<void>('/api/media-order', { order, hidden });
  }

  deleteMediaFile(path: string): Observable<{ ok: boolean; path: string }> {
    return this.http.delete<{ ok: boolean; path: string }>(`/api/media-file?path=${encodeURIComponent(path)}`);
  }

  getPlaybackState(): Observable<PlaybackState> {
    return this.http.get<PlaybackState>('/api/playlist');
  }

  getOverlays(): Observable<OverlayLayer[]> {
    return this.http.get<OverlayLayer[]>('/api/overlays');
  }

  saveOverlays(layers: OverlayLayer[]): Observable<void> {
    return this.http.post<void>('/api/overlays', layers);
  }

  // Opens an OS-native folder/file dialog on the machine running the local Node server.
  pickFolderNative(): Observable<{ path: string | null }> {
    return this.http.post<{ path: string | null }>('/api/pick-folder', {});
  }

  pickFileNative(): Observable<{ path: string | null }> {
    return this.http.post<{ path: string | null }>('/api/pick-file', {});
  }

  browseFiles(path?: string): Observable<FileBrowserResponse> {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.http.get<FileBrowserResponse>(`/api/file-browser${query}`);
  }

  createLibraryFolder(parent: string, name: string): Observable<{ ok: boolean; path: string }> {
    return this.http.post<{ ok: boolean; path: string }>('/api/create-library-folder', { parent, name });
  }

  sendPlaybackCommand(command: PlaybackCommand, index?: number): Observable<void> {
    return this.http.post<void>('/api/playback-command', { command, index });
  }

  uploadMedia(files: File[], destination: string): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('destination', destination);
    for (const file of files) {
      formData.append('files', file, file.name);
    }

    return this.http.post<UploadResponse>('/api/upload', formData);
  }
}
