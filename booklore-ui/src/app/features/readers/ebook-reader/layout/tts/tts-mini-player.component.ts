import {Component, EventEmitter, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ReaderIconComponent} from '../../shared/icon.component';
import {ReaderTtsService} from '../../features/tts/tts.service';

@Component({
  selector: 'app-reader-tts-mini-player',
  standalone: true,
  imports: [CommonModule, ReaderIconComponent],
  templateUrl: './tts-mini-player.component.html',
  styleUrl: './tts-mini-player.component.scss'
})
export class ReaderTtsMiniPlayerComponent {
  private readonly ttsService = inject(ReaderTtsService);

  @Output() collapse = new EventEmitter<void>();
  @Output() openSettings = new EventEmitter<void>();

  get state() {
    return this.ttsService.currentState;
  }

  onTogglePlayPause(): void {
    this.ttsService.togglePlayPause();
  }

  onPrevious(): void {
    this.ttsService.playPrevious();
  }

  onNext(): void {
    this.ttsService.playNext();
  }

  onPreviousParagraph(): void {
    this.ttsService.playPreviousParagraph();
  }

  onNextParagraph(): void {
    this.ttsService.playNextParagraph();
  }

  onDecreaseRate(): void {
    this.ttsService.setRate(this.state.rate - 0.1);
  }

  onIncreaseRate(): void {
    this.ttsService.setRate(this.state.rate + 0.1);
  }
}
