import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type LastFmMusicLibraryPlugin from "./main";

export interface LastFmSettings {
  apiKey: string;
  username: string;
  folder: string;
  historyFilePath: string;
  autoSyncEnabled: boolean;
}

export const DEFAULT_SETTINGS: LastFmSettings = {
  apiKey: "",
  username: "",
  folder: "Music Library",
  historyFilePath: "",
  autoSyncEnabled: false,
};

export class LastFmSettingTab extends PluginSettingTab {
  plugin: LastFmMusicLibraryPlugin;

  constructor(app: App, plugin: LastFmMusicLibraryPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Last.fm Music Library")
      .setHeading();

    new Setting(containerEl)
      .setName("Last.fm API key")
      .setDesc("Get it at https://www.last.fm/api/account/create")
      .addText((text) =>
        text
          .setPlaceholder("API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Last.fm username")
      .addText((text) =>
        text
          .setPlaceholder("username")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Notes folder")
      .setDesc("Folder where track notes will be saved")
      .addText((text) =>
        text
          .setPlaceholder("Music Library")
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("History file path")
      .setDesc("Full path to history file (e.g., Music Library/History.md). Leave empty to auto-generate.")
      .addText((text) =>
        text
          .setPlaceholder("Leave empty for auto-generation")
          .setValue(this.plugin.settings.historyFilePath)
          .onChange(async (value) => {
            this.plugin.settings.historyFilePath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Automatic sync")
      .setDesc("Sync every 30 minutes (fixed interval)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncEnabled = value;
            await this.plugin.saveSettings();

            if (value) {
              this.plugin.enableAutoSync();
              new Notice("Auto-sync enabled — every 30 minutes");
            } else {
              this.plugin.disableAutoSync();
              new Notice("Auto-sync disabled");
            }
          })
      );
  }
}