import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../services/api.service';
import { I18nService } from '../services/i18n.service';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.scss',
})
export class UploadComponent {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  selectedFiles: File[] = [];
  uploading = false;
  message = '';
  error = '';

  constructor(
    private readonly api: ApiService,
    public readonly i18n: I18nService,
  ) {}

  chooseFiles(): void {
    this.fileInput?.nativeElement.click();
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFiles = Array.from(input.files ?? []);
    this.message = '';
    this.error = '';
  }

  upload(): void {
    if (!this.selectedFiles.length || this.uploading) return;

    this.uploading = true;
    this.message = '';
    this.error = '';

    this.api.uploadMedia(this.selectedFiles).subscribe({
      next: (result) => {
        this.uploading = false;
        this.message = `${result.uploaded.length} ${this.i18n.t('upload.success')}`;
        this.selectedFiles = [];
        if (this.fileInput) this.fileInput.nativeElement.value = '';
      },
      error: (requestError: { error?: { error?: string } }) => {
        this.uploading = false;
        this.error = requestError.error?.error ?? this.i18n.t('upload.failed');
      },
    });
  }

  clear(): void {
    this.selectedFiles = [];
    this.message = '';
    this.error = '';
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }
}
