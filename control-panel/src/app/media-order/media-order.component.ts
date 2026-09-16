import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../services/api.service';
import { I18nService } from '../services/i18n.service';

const ALL_FOLDERS = '__ALL_FOLDERS__';
const ROOT_FOLDER = '__ROOT_FOLDER__';
type MediaOrderViewMode = 'folders' | 'folders+files';

@Component({
  selector: 'app-media-order',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatIconModule],
  templateUrl: './media-order.component.html',
  styleUrl: './media-order.component.scss',
})
export class MediaOrderComponent implements OnInit {
  items: string[] = [];
  currentFolder = '';
  selectedTopLevelFolder = ALL_FOLDERS;
  viewMode: MediaOrderViewMode = 'folders+files';
  loaded = false;
  hiddenPaths = new Set<string>();

  constructor(private api: ApiService, private snackBar: MatSnackBar, public readonly i18n: I18nService) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.getSettings().subscribe((values) => {
      this.currentFolder = values['mediaFolder'] || '';
      console.log('📂 Control Panel - currentFolder loaded:', this.currentFolder);
    });
    this.api.getMediaOrder().subscribe(({ files, order, hidden }) => {
      console.log('📋 Control Panel - GET /api/media-order response:', { files, order, hidden });
      const known = new Set(files);
      const kept = order.filter((path) => known.has(path));
      const missing = files.filter((path) => !kept.includes(path));
      this.items = [...kept, ...missing];
      this.hiddenPaths = new Set(hidden ?? []);
      if (!this.topLevelFolders.includes(this.selectedTopLevelFolder)) {
        this.selectedTopLevelFolder = ALL_FOLDERS;
      }
      console.log('📺 Control Panel - items set to:', this.items);
      this.loaded = true;
    });
  }

  get topLevelFolders(): string[] {
    const folders = new Set(this.items.map((path) => this.topLevelFolderOf(path)));
    return [ALL_FOLDERS, ...Array.from(folders).sort((left, right) => this.folderLabel(left).localeCompare(this.folderLabel(right)))];
  }

  get topLevelFolderGroups(): Array<{ key: string; label: string; count: number }> {
    return this.topLevelFolders
      .filter((folder) => folder !== ALL_FOLDERS)
      .map((folder) => ({
        key: folder,
        label: this.folderLabel(folder),
        count: this.items.filter((path) => this.topLevelFolderOf(path) === folder).length,
      }));
  }

  get visibleItems(): string[] {
    if (this.selectedTopLevelFolder === ALL_FOLDERS) {
      return this.items;
    }

    return this.items.filter((path) => this.topLevelFolderOf(path) === this.selectedTopLevelFolder);
  }

  get visibleCount(): number {
    if (this.viewMode === 'folders') {
      return this.topLevelFolderGroups.length;
    }

    return this.visibleItems.length;
  }

  get selectionSummary(): string {
    if (this.viewMode === 'folders') {
      return this.i18n.t('mediaOrder.summaryFolders');
    }

    return this.i18n.t(this.selectedTopLevelFolder === ALL_FOLDERS ? 'mediaOrder.summaryAllItems' : 'mediaOrder.summarySelectedItems');
  }

  folderLabel(folder: string): string {
    if (folder === ALL_FOLDERS) return this.i18n.t('mediaOrder.allFolders');
    if (folder === ROOT_FOLDER) return this.i18n.t('mediaOrder.rootFiles');
    return folder;
  }

  displayPath(path: string): string {
    if (this.selectedTopLevelFolder === ALL_FOLDERS) {
      return path;
    }

    const prefix = this.selectedTopLevelFolder === ROOT_FOLDER ? '' : `${this.selectedTopLevelFolder}/`;
    return prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }

  trackByPath(_index: number, path: string): string {
    return path;
  }

  trackByFolder(_index: number, group: { key: string }): string {
    return group.key;
  }

  isHidden(path: string): boolean {
    return this.hiddenPaths.has(path);
  }

  isFolderHidden(folder: string): boolean {
    const files = this.items.filter((path) => this.topLevelFolderOf(path) === folder);
    if (files.length === 0) return false;
    if (folder === ROOT_FOLDER) return files.every((path) => this.hiddenPaths.has(path));
    return this.hiddenPaths.has(`${folder}/`);
  }

  toggleHidden(path: string): void {
    if (this.hiddenPaths.has(path)) {
      this.hiddenPaths.delete(path);
    } else {
      this.hiddenPaths.add(path);
    }
  }

  toggleFolderHidden(folder: string): void {
    const files = this.items.filter((path) => this.topLevelFolderOf(path) === folder);
    const hidden = this.isFolderHidden(folder);

    if (folder === ROOT_FOLDER) {
      for (const file of files) {
        if (hidden) this.hiddenPaths.delete(file);
        else this.hiddenPaths.add(file);
      }
      return;
    }

    const key = `${folder}/`;
    if (hidden) this.hiddenPaths.delete(key);
    else this.hiddenPaths.add(key);
  }

  deleteFile(path: string): void {
    if (!window.confirm(this.i18n.t('mediaOrder.confirmDelete'))) return;

    this.api.deleteMediaFile(path).subscribe({
      next: () => {
        this.items = this.items.filter((item) => item !== path);
        this.hiddenPaths.delete(path);
        this.snackBar.open(this.i18n.t('mediaOrder.deleted'), this.i18n.t('ok'), { duration: 3000 });
      },
      error: () => {
        this.snackBar.open(this.i18n.t('mediaOrder.deleteError'), this.i18n.t('ok'), { duration: 5000 });
      },
    });
  }

  drop(event: CdkDragDrop<string[]>): void {
    if (this.viewMode === 'folders') {
      this.reorderTopLevelFolders(event.previousIndex, event.currentIndex);
      return;
    }

    if (this.selectedTopLevelFolder === ALL_FOLDERS) {
      moveItemInArray(this.items, event.previousIndex, event.currentIndex);
      return;
    }

    const visibleItems = [...this.visibleItems];
    moveItemInArray(visibleItems, event.previousIndex, event.currentIndex);
    const visibleSet = new Set(visibleItems);
    let visibleIndex = 0;
    this.items = this.items.map((path) => (
      visibleSet.has(path) ? visibleItems[visibleIndex++] : path
    ));
  }

  resetToDefault(): void {
    this.reload();
  }

  save(): void {
    console.log('💾 Control Panel - Saving media order:', this.items);
    this.api.saveMediaOrder(this.items, Array.from(this.hiddenPaths)).subscribe(
      () => {
        console.log('✓ Control Panel - Order saved successfully');
        this.snackBar.open(this.i18n.t('mediaOrder.saved'), this.i18n.t('ok'), { duration: 3000 });
      },
      (error) => {
        console.error('✗ Control Panel - Error saving order:', error);
        this.snackBar.open(this.i18n.t('mediaOrder.saveError') + (error?.message || error), this.i18n.t('ok'), { duration: 5000 });
      }
    );
  }

  private topLevelFolderOf(path: string): string {
    const slashIndex = path.indexOf('/');
    return slashIndex === -1 ? ROOT_FOLDER : path.slice(0, slashIndex);
  }

  private reorderTopLevelFolders(previousIndex: number, currentIndex: number): void {
    const folderOrder = this.topLevelFolderGroups.map((group) => group.key);
    moveItemInArray(folderOrder, previousIndex, currentIndex);

    const folderBuckets = new Map<string, string[]>();
    for (const path of this.items) {
      const folder = this.topLevelFolderOf(path);
      const bucket = folderBuckets.get(folder) ?? [];
      bucket.push(path);
      folderBuckets.set(folder, bucket);
    }

    this.items = folderOrder.flatMap((folder) => folderBuckets.get(folder) ?? []);
  }
}
