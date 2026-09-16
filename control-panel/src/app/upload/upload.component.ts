import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService, FileBrowserEntry } from '../services/api.service';
import { I18nService } from '../services/i18n.service';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.scss',
})
export class UploadComponent implements OnInit {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  selectedFiles: File[] = [];
  uploading = false;
  message = '';
  error = '';
  libraryFolder = '';
  destinationFolder = '';
  destinationEntries: FileBrowserEntry[] = [];
  newFolderName = '';
  browserLoading = false;
  creatingFolder = false;

  constructor(
    private readonly api: ApiService,
    public readonly i18n: I18nService,
  ) {}

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: (settings) => {
        this.libraryFolder = settings['mediaFolder'] || '';
        this.destinationFolder = this.libraryFolder;
        this.loadDestinationFolders();
      },
      error: () => { this.error = this.i18n.t('upload.libraryUnavailable'); },
    });
  }

  loadDestinationFolders(): void {
    if (!this.destinationFolder) return;
    this.browserLoading = true;
    this.api.browseFiles(this.destinationFolder).subscribe({
      next: ({ entries }) => {
        this.destinationEntries = entries.filter((entry) => entry.type === 'directory');
        this.browserLoading = false;
      },
      error: () => {
        this.browserLoading = false;
        this.error = this.i18n.t('upload.libraryUnavailable');
      },
    });
  }

  selectDestination(folder: string): void {
    this.destinationFolder = folder;
    this.loadDestinationFolders();
  }

  isLibraryRoot(): boolean {
    return this.destinationFolder === this.libraryFolder;
  }

  createFolder(): void {
    const name = this.newFolderName.trim();
    if (!name || this.creatingFolder || !this.destinationFolder) return;

    this.creatingFolder = true;
    this.error = '';
    this.api.createLibraryFolder(this.destinationFolder, name).subscribe({
      next: ({ path }) => {
        this.newFolderName = '';
        this.creatingFolder = false;
        this.selectDestination(path);
      },
      error: (requestError: { error?: { error?: string } }) => {
        this.creatingFolder = false;
        this.error = requestError.error?.error ?? this.i18n.t('upload.folderFailed');
      },
    });
  }

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

    this.api.uploadMedia(this.selectedFiles, this.destinationFolder).subscribe({
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
