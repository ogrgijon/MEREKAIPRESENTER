import { Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SettingsComponent } from './settings/settings.component';
import { MediaOrderComponent } from './media-order/media-order.component';
import { OverlayDesignerComponent } from './overlay-designer/overlay-designer.component';
import { PlaylistComponent } from './playlist/playlist.component';
import { ApiService, PlaybackCommand } from './services/api.service';
import { I18nService } from './services/i18n.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    MatToolbarModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    SettingsComponent,
    MediaOrderComponent,
    OverlayDesignerComponent,
    PlaylistComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  darkTheme = false;
  readonly transportButtons: Array<{ labelKey: string; command: PlaybackCommand; accent?: boolean }> = [
    { labelKey: 'transport.back', command: 'back' },
    { labelKey: 'transport.play', command: 'play', accent: true },
    { labelKey: 'transport.pause', command: 'pause' },
    { labelKey: 'transport.next', command: 'next' },
    { labelKey: 'transport.slow', command: 'slow' },
    { labelKey: 'transport.fast', command: 'fast' },
  ];

  constructor(
    private readonly api: ApiService,
    private readonly snackBar: MatSnackBar,
    public readonly i18n: I18nService,
  ) {}

  toggleTheme(): void {
    this.darkTheme = !this.darkTheme;
    document.body.classList.toggle('dark-theme', this.darkTheme);
  }

  toggleLanguage(): void {
    this.i18n.toggleLanguage();
  }

  openPlayer(): void {
    window.open('/player/', '_blank', 'noopener,noreferrer');
  }

  sendPlaybackCommand(command: PlaybackCommand): void {
    this.api.sendPlaybackCommand(command).subscribe({
      error: () => {
        this.snackBar.open('Playback command failed', 'OK', { duration: 2500 });
      },
    });
  }
}
