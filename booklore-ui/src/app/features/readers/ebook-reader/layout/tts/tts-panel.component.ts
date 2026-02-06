import {Component, EventEmitter, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ReaderIconComponent} from '../../shared/icon.component';
import {ReaderTtsProviderOption, ReaderTtsService, ReaderTtsVoice} from '../../features/tts/tts.service';

@Component({
  selector: 'app-reader-tts-panel',
  standalone: true,
  imports: [CommonModule, ReaderIconComponent],
  templateUrl: './tts-panel.component.html',
  styleUrl: './tts-panel.component.scss'
})
export class ReaderTtsPanelComponent implements OnInit {
  private ttsService = inject(ReaderTtsService);

  @Output() close = new EventEmitter<void>();
  providerMenuOpen = false;
  voiceMenuOpen = false;

  ngOnInit(): void {
    this.ttsService.refreshProvidersAndVoices();
  }

  get state() {
    return this.ttsService.currentState;
  }

  get showProviderSelector(): boolean {
    return this.state.providers.length > 1;
  }

  get visibleVoices(): ReaderTtsVoice[] {
    return this.state.voices.filter(voice => voice.providerId === this.state.providerId);
  }

  get activeProviderLabel(): string {
    return this.state.providers.find(provider => provider.id === this.state.providerId)?.label ?? 'Select engine';
  }

  get activeVoiceLabel(): string {
    if (!this.visibleVoices.length) {
      return this.state.loadingVoices ? 'Loading voices...' : 'No voices available';
    }

    const selected = this.visibleVoices.find(voice => voice.id === this.state.selectedVoiceId);
    const fallback = selected ?? this.visibleVoices[0];
    return `${fallback.name} (${fallback.lang || 'default'})`;
  }

  onToggleProviderMenu(event: Event): void {
    event.stopPropagation();
    this.voiceMenuOpen = false;
    this.providerMenuOpen = !this.providerMenuOpen;
  }

  onToggleVoiceMenu(event: Event): void {
    event.stopPropagation();
    if (this.state.loadingVoices || !this.visibleVoices.length) {
      return;
    }
    this.providerMenuOpen = false;
    this.voiceMenuOpen = !this.voiceMenuOpen;
  }

  onSelectProvider(provider: ReaderTtsProviderOption): void {
    if (!provider.available || provider.id === this.state.providerId) {
      this.providerMenuOpen = false;
      return;
    }
    this.ttsService.selectProvider(provider.id);
    this.providerMenuOpen = false;
    this.voiceMenuOpen = false;
  }

  onSelectVoice(voiceId: string): void {
    this.ttsService.selectVoice(voiceId);
    this.voiceMenuOpen = false;
  }

  onPanelClick(): void {
    this.providerMenuOpen = false;
    this.voiceMenuOpen = false;
  }

  onTogglePlayPause(): void {
    this.ttsService.togglePlayPause();
  }

  onStop(): void {
    this.ttsService.stop();
  }

  onPrevious(): void {
    this.ttsService.playPrevious();
  }

  onNext(): void {
    this.ttsService.playNext();
  }

  onDecreaseRate(): void {
    this.ttsService.setRate(this.state.rate - 0.1);
  }

  onIncreaseRate(): void {
    this.ttsService.setRate(this.state.rate + 0.1);
  }

  onOverlayClick(): void {
    this.close.emit();
  }
}
