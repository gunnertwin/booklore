import {Component, EventEmitter, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ReaderIconComponent} from '../../shared/icon.component';
import {ReaderTtsService} from '../../features/tts/tts.service';

@Component({
  selector: 'app-reader-tts-panel',
  standalone: true,
  imports: [CommonModule, ReaderIconComponent],
  templateUrl: './tts-panel.component.html',
  styleUrl: './tts-panel.component.scss'
})
export class ReaderTtsPanelComponent {
  private ttsService = inject(ReaderTtsService);

  @Output() close = new EventEmitter<void>();

  get state() {
    return this.ttsService.currentState;
  }

  get showProviderSelector(): boolean {
    return this.state.providers.length > 1;
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

  onVoiceChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.ttsService.selectVoice(target.value || null);
  }

  onProviderChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.ttsService.selectProvider(target.value);
  }

  onOverlayClick(): void {
    this.close.emit();
  }
}
