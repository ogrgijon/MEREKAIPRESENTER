import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SettingsComponent } from './settings/settings.component';
import { MediaOrderComponent } from './media-order/media-order.component';
import { OverlayDesignerComponent } from './overlay-designer/overlay-designer.component';
import { PlaylistComponent } from './playlist/playlist.component';
import { UploadComponent } from './upload/upload.component';
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
    MatDialogModule,
    SettingsComponent,
    MediaOrderComponent,
    OverlayDesignerComponent,
    PlaylistComponent,
    UploadComponent,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @ViewChild(MediaOrderComponent) private mediaOrder?: MediaOrderComponent;

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
    private readonly dialog: MatDialog,
    public readonly i18n: I18nService,
  ) {}

  openAccessDialog(): void {
    this.dialog.open(AccessDialogComponent, { width: 'min(460px, calc(100vw - 32px))' });
  }

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

  onTabChange(index: number): void {
    if (index === 1) {
      this.mediaOrder?.reload();
    }
  }
}

@Component({
  selector: 'app-access-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ i18n.t('security.dialogTitle') }}</h2>
    <mat-dialog-content class="access-dialog-content">
      <p>{{ i18n.t('security.dialogDescription') }}</p>
      <mat-form-field appearance="outline">
        <mat-label>{{ i18n.t('security.username') }}</mat-label>
        <input matInput [(ngModel)]="username" autocomplete="username">
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>{{ i18n.t('security.password') }}</mat-label>
        <input matInput type="password" [(ngModel)]="password" autocomplete="new-password">
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>{{ i18n.t('security.confirmPassword') }}</mat-label>
        <input matInput type="password" [(ngModel)]="confirmation" autocomplete="new-password">
      </mat-form-field>
      <p class="access-dialog-error" *ngIf="error">{{ error }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">{{ i18n.t('cancel') }}</button>
      <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="saving">{{ i18n.t('security.save') }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .access-dialog-content { display: grid; gap: 8px; }
    .access-dialog-content p { margin: 0 0 8px; color: var(--muted); line-height: 1.45; }
    mat-form-field { width: 100%; }
    .access-dialog-error { color: #b42318 !important; font-weight: 700; }
  `]
})
export class AccessDialogComponent {
  username = 'user';
  password = '';
  confirmation = '';
  saving = false;
  error = '';

  constructor(
    private readonly api: ApiService,
    private readonly dialogRef: MatDialogRef<AccessDialogComponent>,
    public readonly i18n: I18nService,
  ) {}

  close(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (!this.username.trim() || this.password.length < 4 || this.password !== this.confirmation) {
      this.error = this.i18n.t('security.dialogValidation');
      return;
    }

    this.saving = true;
    this.error = '';
    this.api.saveAuthentication(this.username.trim(), this.password, true).subscribe({
      next: () => this.dialogRef.close(true),
      error: () => {
        this.saving = false;
        this.error = this.i18n.t('security.failed');
      },
    });
  }
}
