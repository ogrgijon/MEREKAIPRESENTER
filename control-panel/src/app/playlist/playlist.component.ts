import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Subscription, interval, startWith, switchMap } from 'rxjs';
import { ApiService, PlaybackState } from '../services/api.service';
import { I18nService } from '../services/i18n.service';

@Component({
  selector: 'app-playlist',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './playlist.component.html',
  styleUrl: './playlist.component.scss',
})
export class PlaylistComponent implements AfterViewChecked, OnDestroy, OnInit {
  @ViewChild('playlistList') private playlistList?: ElementRef<HTMLElement>;

  state: PlaybackState = {
    current: null,
    next: null,
    index: 0,
    total: 0,
    isPlaying: false,
    playingSpecial: false,
    specialPlaybackKind: null,
    playlist: [],
    elapsedSeconds: 0,
    durationSeconds: 0,
    mediaType: null,
  };

  private refreshSubscription?: Subscription;
  private settingsSubscription?: Subscription;
  insertFile = '';
  alertFile = '';
  private shouldScrollToCurrent = false;
  private lastCurrent = '';

  constructor(private readonly api: ApiService, public readonly i18n: I18nService) {}

  get playlist(): string[] {
    return this.state.playlist ?? [];
  }

  ngOnInit(): void {
    this.refreshSubscription = interval(1000)
      .pipe(
        startWith(0),
        switchMap(() => this.api.getPlaybackState()),
      )
      .subscribe({
        next: (state) => {
          this.state = state;
          if (state.current !== this.lastCurrent) {
            this.lastCurrent = state.current ?? '';
            this.shouldScrollToCurrent = true;
          }
        },
      });

    this.settingsSubscription = interval(2000)
      .pipe(
        startWith(0),
        switchMap(() => this.api.getSettings()),
      )
      .subscribe((settings) => {
        this.insertFile = settings['insertFile']?.trim() ?? '';
        this.alertFile = settings['alertFile']?.trim() ?? '';
      });
  }

  ngAfterViewChecked(): void {
    if (!this.shouldScrollToCurrent || !this.playlistList) {
      return;
    }

    const current = this.playlistList.nativeElement.querySelector('.playlist-item-current');
    current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.shouldScrollToCurrent = false;
  }

  ngOnDestroy(): void {
    this.refreshSubscription?.unsubscribe();
    this.settingsSubscription?.unsubscribe();
  }

  fileName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || filePath;
  }

  folderPath(filePath: string): string {
    const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return separator >= 0 ? filePath.slice(0, separator) : '';
  }

  isCurrent(filePath: string): boolean {
    return filePath === this.state.current;
  }

  progressFor(index: number): number {
    if (this.state.playingSpecial) {
      return 0;
    }

    if (index < this.state.index) {
      return 100;
    }

    if (index > this.state.index || !this.state.durationSeconds) {
      return 0;
    }

    return Math.min(100, Math.max(0, (this.state.elapsedSeconds / this.state.durationSeconds) * 100));
  }

  formatTime(seconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
  }

  playItem(index: number): void {
    this.api.sendPlaybackCommand('play', index).subscribe();
  }

  forcePlay(kind: 'insert' | 'alert'): void {
    this.api.sendPlaybackCommand(kind).subscribe();
  }

  isSpecial(kind: 'insert' | 'alert'): boolean {
    return this.state.playingSpecial && this.state.specialPlaybackKind === kind;
  }
}
