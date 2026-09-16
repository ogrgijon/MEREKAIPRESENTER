import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../services/api.service';
import { I18nService } from '../services/i18n.service';

type FieldType = 'text' | 'multiline' | 'number' | 'boolean' | 'select';
type FieldSection = 'library' | 'playback' | 'insert' | 'alert';

interface FieldOption {
  value: string;
  label: string;
}

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  section: FieldSection;
  defaultValue: string;
  description?: string;
  options?: FieldOption[];
  browse?: 'folder' | 'file';
  min?: number;
  max?: number;
  step?: string;
}

interface SettingPreset {
  id: string;
  label: string;
  description: string;
  values: Record<string, string>;
}

interface InsertSchedule {
  file: string;
  everyN: number;
  afterFolder: boolean;
  folderScope: 'top' | 'exact';
  onLoop: boolean;
  hideOverlays: boolean;
}

const FIELDS: FieldDef[] = [
  { key: 'mediaFolder', label: 'fields.mediaFolder.label', type: 'text', section: 'library', browse: 'folder', defaultValue: '', description: 'fields.mediaFolder.description' },
  { key: 'slideDurationSeconds', label: 'fields.slideDurationSeconds.label', type: 'number', section: 'playback', defaultValue: '5', min: 1, step: '1', description: 'fields.slideDurationSeconds.description' },
  { key: 'shuffle', label: 'fields.shuffle.label', type: 'boolean', section: 'playback', defaultValue: 'false', description: 'fields.shuffle.description' },
  { key: 'volume', label: 'fields.volume.label', type: 'number', section: 'playback', defaultValue: '0.8', min: 0, max: 1, step: '0.05', description: 'fields.volume.description' },
  {
    key: 'fitMode',
    label: 'Fit mode',
    type: 'select',
    section: 'playback',
    defaultValue: 'cover',
    options: [
      { value: 'cover', label: 'fields.fitMode.option.cover' },
      { value: 'contain', label: 'fields.fitMode.option.contain' },
    ],
    description: 'fields.slideDurationSeconds.description',
  },
  { key: 'kenBurns', label: 'fields.kenBurns.label', type: 'boolean', section: 'playback', defaultValue: 'false', description: 'fields.kenBurns.description' },
  { key: 'alertFile', label: 'fields.alertFile.label', type: 'text', section: 'alert', browse: 'file', defaultValue: '', description: 'fields.alertFile.description' },
  { key: 'alertIntervalSeconds', label: 'fields.alertIntervalSeconds.label', type: 'number', section: 'alert', defaultValue: '0', min: 0, step: '1', description: 'fields.alertIntervalSeconds.label' },
];

const SECTIONS: Array<{ key: FieldSection; title: string; description: string }> = [
  { key: 'library', title: 'section.library.title', description: 'section.library.description' },
  { key: 'playback', title: 'section.playback.title', description: 'section.playback.description' },
  { key: 'insert', title: 'section.insert.title', description: 'section.insert.description' },
  { key: 'alert', title: 'section.alert.title', description: 'section.alert.description' },
];

const PRESETS: SettingPreset[] = [
  {
    id: 'gallery',
    label: 'preset.gallery.label',
    description: 'preset.gallery.description',
    values: {
      slideDurationSeconds: '7',
      volume: '0.35',
      fitMode: 'contain',
      kenBurns: 'true',
      shuffle: 'false',
    },
  },
  {
    id: 'cinema',
    label: 'preset.cinema.label',
    description: 'preset.cinema.description',
    values: {
      slideDurationSeconds: '4',
      volume: '0.8',
      fitMode: 'cover',
      kenBurns: 'false',
      shuffle: 'false',
    },
  },
  {
    id: 'signage',
    label: 'preset.signage.label',
    description: 'preset.signage.description',
    values: {
      slideDurationSeconds: '10',
      volume: '0',
      fitMode: 'contain',
      kenBurns: 'false',
      shuffle: 'true',
    },
  },
];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  fields = FIELDS;
  sections = SECTIONS;
  presets = PRESETS;
  values: Record<string, string> = {};
  savedValues: Record<string, string> = {};
  insertSchedules: InsertSchedule[] = [];
  savedInsertSchedules: InsertSchedule[] = [];
  loaded = false;
  saving = false;

  constructor(private api: ApiService, private snackBar: MatSnackBar, public i18n: I18nService) {}

  ngOnInit(): void {
    this.reloadSettings();
  }

  fieldsFor(section: FieldSection): FieldDef[] {
    return this.fields.filter((field) => field.section === section);
  }

  isChecked(key: string): boolean {
    return this.values[key] === 'true';
  }

  setChecked(key: string, checked: boolean): void {
    this.values[key] = checked ? 'true' : 'false';
  }

  applyPreset(preset: SettingPreset): void {
    this.values = this.sanitizeValues({
      ...this.values,
      ...preset.values,
    });
  }

  addInsertSchedule(): void {
    this.insertSchedules.push(this.emptyInsertSchedule());
  }

  removeInsertSchedule(index: number): void {
    this.insertSchedules.splice(index, 1);
  }

  browseInsertSchedule(index: number): void {
    this.api.pickFileNative().subscribe({
      next: ({ path }) => {
        if (path) this.insertSchedules[index].file = path;
      },
      error: () => {
        this.snackBar.open(this.i18n.t('settings.nativePickerError'), this.i18n.t('ok'), { duration: 3500 });
      },
    });
  }

  browseFolder(field: FieldDef): void {
    const pick = field.browse === 'file' ? this.api.pickFileNative() : this.api.pickFolderNative();
    pick.subscribe({
      next: ({ path }) => {
        if (!path) return;
        if (field.key === 'insertFiles') {
          const existing = this.values[field.key]?.trim();
          this.values[field.key] = existing ? `${existing}\n${path}` : path;
        } else {
          this.values[field.key] = path;
        }
      },
      error: () => {
        this.snackBar.open(this.i18n.t('settings.nativePickerError'), this.i18n.t('ok'), { duration: 3500 });
      },
    });
  }

  clearField(key: string): void {
    const field = this.fields.find((entry) => entry.key === key);
    if (!field) return;
    this.values[key] = field.defaultValue;
  }

  isDisabled(field: FieldDef): boolean {
    if (field.key !== 'alertFile' && field.key.startsWith('alert')) {
      return !this.values['alertFile']?.trim();
    }

    return false;
  }

  helperText(section: FieldSection): string | null {
    if (section === 'insert' && this.insertSchedules.length === 0) {
      return this.i18n.t('helper.insert.chooseInsert');
    }

    if (section === 'alert' && !this.values['alertFile']?.trim()) {
      return this.i18n.t('helper.alert.chooseAlert');
    }

    return null;
  }

  hasChanges(): boolean {
    const current = { ...this.sanitizeValues(this.values), insertSchedules: JSON.stringify(this.insertSchedules) };
    return JSON.stringify(current) !== JSON.stringify(this.savedValues);
  }

  validationMessages(): string[] {
    const values = this.sanitizeValues(this.values);
    const messages: string[] = [];

    if (!values['mediaFolder'].trim()) {
      messages.push(this.i18n.t('validation.mediaFolderEmpty'));
    }

    if (Number.parseInt(values['slideDurationSeconds'], 10) < 1) {
      messages.push(this.i18n.t('validation.slideDurationMin'));
    }

    const volume = Number.parseFloat(values['volume']);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      messages.push(this.i18n.t('validation.volumeRange'));
    }

    for (const schedule of this.insertSchedules) {
      const insertEnabled = schedule.everyN > 0 || schedule.afterFolder || schedule.onLoop;
      if (insertEnabled && !schedule.file.trim()) {
        messages.push(this.i18n.t('validation.insertEnabledNoClip'));
      }
      if (schedule.file.trim() && !insertEnabled) {
        messages.push(this.i18n.t('validation.insertClipTriggersOff'));
      }
    }

    if (Number.parseInt(values['alertIntervalSeconds'], 10) > 0 && !values['alertFile'].trim()) {
      messages.push(this.i18n.t('validation.alertIntervalNoClip'));
    }

    return messages;
  }

  activeSummary(): string[] {
    const values = this.sanitizeValues(this.values);
    const summary: string[] = [];

    summary.push(this.i18n.t('summary.images_prefix') + values['slideDurationSeconds'] + this.i18n.t('summary.seconds_suffix'));
    summary.push(this.i18n.t('summary.video_volume_prefix') + values['volume']);
    summary.push(values['fitMode'] === 'cover' ? this.i18n.t('summary.fit_cover') : this.i18n.t('summary.fit_contain'));
    summary.push(values['shuffle'] === 'true' ? this.i18n.t('summary.playback_shuffled') : this.i18n.t('summary.playback_ordered'));

    if (this.insertSchedules.length > 0) {
      summary.push(`${this.i18n.t('summary.insert_prefix')}${this.insertSchedules.length}`);
    } else {
      summary.push(this.i18n.t('summary.insert_disabled'));
    }

    summary.push(Number.parseInt(values['alertIntervalSeconds'], 10) > 0 && values['alertFile'].trim() ? this.i18n.t('summary.alert_every_prefix') + values['alertIntervalSeconds'] + this.i18n.t('summary.seconds_suffix') : this.i18n.t('summary.alert_disabled'));

    return summary;
  }

  reloadSettings(): void {
    this.api.getSettings().subscribe({
      next: (values) => {
        this.insertSchedules = this.parseInsertSchedules(values);
        this.savedInsertSchedules = this.cloneInsertSchedules(this.insertSchedules);
        this.savedValues = { ...this.sanitizeValues(values), insertSchedules: JSON.stringify(this.insertSchedules) };
        this.values = { ...this.savedValues };
        this.loaded = true;
      },
      error: () => {
        this.snackBar.open('Failed to load settings', 'OK', { duration: 3000 });
      },
    });
  }

  revertChanges(): void {
    this.values = { ...this.savedValues };
    this.insertSchedules = this.cloneInsertSchedules(this.savedInsertSchedules);
  }

  resetToDefaults(): void {
    this.values = this.withDefaults({ mediaFolder: this.values['mediaFolder'] ?? '' });
    this.insertSchedules = [];
  }

  canSave(): boolean {
    return this.loaded && !this.saving && this.hasChanges() && !this.hasBlockingErrors();
  }

  private hasBlockingErrors(): boolean {
    const values = this.sanitizeValues(this.values);
    const volume = Number.parseFloat(values['volume']);
    return !Number.isFinite(volume) || volume < 0 || volume > 1;
  }

  private withDefaults(values: Record<string, string>): Record<string, string> {
    const nextValues = { ...values };

    for (const field of this.fields) {
      if (nextValues[field.key]?.length) continue;
      nextValues[field.key] = field.defaultValue;
    }

    return nextValues;
  }

  private sanitizeValues(source: Record<string, string>): Record<string, string> {
    const nextValues = this.withDefaults({ ...source });

    nextValues['slideDurationSeconds'] = this.sanitizeInteger(nextValues['slideDurationSeconds'], 5, 1);
    nextValues['alertIntervalSeconds'] = this.sanitizeInteger(nextValues['alertIntervalSeconds'], 0, 0);
    nextValues['volume'] = this.sanitizeDecimal(nextValues['volume'], 0.8, 0, 1);

    if (!nextValues['alertFile'].trim()) {
      nextValues['alertIntervalSeconds'] = '0';
    }

    return nextValues;
  }

  private emptyInsertSchedule(): InsertSchedule {
    return { file: '', everyN: 0, afterFolder: false, folderScope: 'top', onLoop: false, hideOverlays: false };
  }

  private parseInsertSchedules(source: Record<string, string>): InsertSchedule[] {
    if (source['insertSchedules']) {
      try {
        const parsed = JSON.parse(source['insertSchedules']) as Partial<InsertSchedule>[];
        if (Array.isArray(parsed)) {
          return parsed.map((item) => ({
            ...this.emptyInsertSchedule(),
            ...item,
            everyN: Math.max(0, Number(item.everyN) || 0),
            folderScope: item.folderScope === 'exact' ? 'exact' : 'top',
          }));
        }
      } catch {
      }
    }

    if (source['insertFile']?.trim()) {
      return [{
        file: source['insertFile'].trim(),
        everyN: Math.max(0, Number(source['insertEveryN']) || 0),
        afterFolder: source['insertAfterFolder'] === 'true',
        folderScope: source['insertFolderScope'] === 'exact' ? 'exact' : 'top',
        onLoop: source['insertOnLoop'] === 'true',
        hideOverlays: source['insertHideOverlays'] === 'true',
      }];
    }

    return [];
  }

  private cloneInsertSchedules(schedules: InsertSchedule[]): InsertSchedule[] {
    return schedules.map((schedule) => ({ ...schedule }));
  }

  private sanitizeInteger(raw: string | undefined, fallback: number, min: number): string {
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed)) return String(fallback);
    return String(Math.max(min, parsed));
  }

  private sanitizeDecimal(raw: string | undefined, fallback: number, min: number, max: number): string {
    const parsed = Number.parseFloat(raw ?? '');
    if (!Number.isFinite(parsed)) return String(fallback);
    return String(Math.min(max, Math.max(min, parsed)));
  }

  save(): void {
    this.values = this.sanitizeValues(this.values);
    this.values['insertSchedules'] = JSON.stringify(this.insertSchedules);

    if (!this.canSave()) {
      if (this.validationMessages().length > 0) {
        this.snackBar.open(this.validationMessages()[0], 'OK', { duration: 3500 });
      }
      return;
    }

    this.saving = true;
    this.api.saveSettings(this.values).subscribe({
      next: () => {
        this.savedValues = { ...this.values };
        this.savedInsertSchedules = this.cloneInsertSchedules(this.insertSchedules);
        this.saving = false;
        this.snackBar.open('Settings saved — display will reload', 'OK', { duration: 3000 });
      },
      error: () => {
        this.saving = false;
        this.snackBar.open('Failed to save settings', 'OK', { duration: 3500 });
      },
    });
  }
}
