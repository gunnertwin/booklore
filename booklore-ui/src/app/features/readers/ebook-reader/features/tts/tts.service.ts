import {Injectable, inject} from '@angular/core';
import {BehaviorSubject, firstValueFrom} from 'rxjs';
import {ReaderViewManagerService} from '../../core/view-manager.service';
import {
  ReaderCloudTtsApiService,
  ReaderCloudTtsProvider,
  ReaderCloudTtsVoice
} from './tts-cloud-api.service';

interface TtsSegment {
  mark: string | null;
  text: string;
  lang?: string;
}

export interface ReaderTtsVoice {
  id: string;
  name: string;
  lang: string;
  isDefault: boolean;
  isNovelty: boolean;
  qualityScore: number;
  providerId: string;
  isNatural: boolean;
}

export interface ReaderTtsProviderOption {
  id: string;
  label: string;
  type: 'browser' | 'cloud';
  available: boolean;
  unavailableReason: string | null;
}

export interface ReaderTtsState {
  supported: boolean;
  isReady: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  rate: number;
  providers: ReaderTtsProviderOption[];
  providerId: string;
  voices: ReaderTtsVoice[];
  selectedVoiceId: string | null;
  loadingVoices: boolean;
  error: string | null;
}

@Injectable()
export class ReaderTtsService {
  private readonly viewManager = inject(ReaderViewManagerService);
  private readonly cloudApi = inject(ReaderCloudTtsApiService);

  private readonly xmlLangNs = 'http://www.w3.org/XML/1998/namespace';
  private readonly browserProviderId = 'browser';
  private readonly rateStorageKey = 'booklore.reader.tts.rate';
  private readonly providerStorageKey = 'booklore.reader.tts.provider';
  private readonly voiceStorageKeyPrefix = 'booklore.reader.tts.voice.';

  private readonly noveltyVoiceNames = [
    'albert',
    'bad news',
    'bahh',
    'bells',
    'boing',
    'bubbles',
    'cello',
    'cellos',
    'chipmunk',
    'chorus',
    'echo',
    'eddy',
    'flo',
    'fred',
    'good news',
    'grandma',
    'grandpa',
    'helium',
    'jester',
    'junior',
    'kathy',
    'monster',
    'organ',
    'ralph',
    'reed',
    'robot',
    'rocko',
    'sandy',
    'shelley',
    'superstar',
    'trinoids',
    'whisper',
    'wobble',
    'zarvox'
  ];

  private readonly speech: SpeechSynthesis | null =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  private readonly audioElement: HTMLAudioElement | null =
    typeof Audio !== 'undefined' ? new Audio() : null;

  private readonly initialState: ReaderTtsState = {
    supported: this.isBrowserSynthesisAvailable(),
    isReady: false,
    isPlaying: false,
    isPaused: false,
    rate: 1,
    providers: [this.createBrowserProvider()],
    providerId: this.browserProviderId,
    voices: [],
    selectedVoiceId: null,
    loadingVoices: false,
    error: null
  };

  private stateSubject = new BehaviorSubject<ReaderTtsState>(this.initialState);
  state$ = this.stateSubject.asObservable();

  private voicesChangedHandler?: () => void;
  private initialized = false;
  private voicesLoadGeneration = 0;
  private playbackGeneration = 0;
  private currentSegments: TtsSegment[] = [];
  private currentSegmentIndex = 0;
  private activeAudioUrl: string | null = null;

  constructor() {
    const storage = this.getStorage();
    if (!storage) {
      return;
    }

    const storedRate = Number(storage.getItem(this.rateStorageKey));
    if (!isNaN(storedRate) && storedRate >= 0.5 && storedRate <= 3) {
      this.patchState({rate: storedRate});
    }

    const storedProviderId = storage.getItem(this.providerStorageKey);
    if (storedProviderId) {
      this.patchState({providerId: storedProviderId});
    }

    const storedVoiceId = this.getStoredVoice(this.currentState.providerId);
    if (storedVoiceId) {
      this.patchState({selectedVoiceId: storedVoiceId});
    }
  }

  get currentState(): ReaderTtsState {
    return this.stateSubject.value;
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    if (this.speech) {
      this.voicesChangedHandler = () => {
        if (this.currentState.providerId === this.browserProviderId) {
          void this.loadVoices();
        }
      };
      this.speech.addEventListener('voiceschanged', this.voicesChangedHandler);
    }

    void this.bootstrap();
  }

  reset(): void {
    this.stop();

    if (this.speech && this.voicesChangedHandler) {
      this.speech.removeEventListener('voiceschanged', this.voicesChangedHandler);
    }
    this.voicesChangedHandler = undefined;
    this.initialized = false;

    this.stateSubject.next({
      ...this.initialState,
      rate: this.currentState.rate,
      providerId: this.currentState.providerId,
      selectedVoiceId: this.currentState.selectedVoiceId,
      providers: this.currentState.providers
    });
  }

  togglePlayPause(): void {
    if (!this.currentState.supported) {
      return;
    }

    if (!this.currentState.isPlaying) {
      this.startFromCurrent();
      return;
    }

    if (this.isCloudProviderSelected()) {
      this.toggleCloudPause();
      return;
    }

    if (!this.speech) {
      return;
    }

    if (this.currentState.isPaused) {
      this.speech.resume();
      this.patchState({isPaused: false, error: null});
    } else {
      this.speech.pause();
      this.patchState({isPaused: true, error: null});
    }
  }

  startFromCurrent(): void {
    void this.startFromCurrentInternal();
  }

  startFromSelection(range: Range): void {
    void this.startFromSelectionInternal(range);
  }

  playNext(): void {
    void this.jump('next');
  }

  playPrevious(): void {
    void this.jump('prev');
  }

  stop(): void {
    this.cancelSpeech(true);
    this.patchState({
      isPlaying: false,
      isPaused: false,
      error: null
    });
  }

  setRate(rate: number): void {
    const clampedRate = Math.max(0.5, Math.min(3, rate));
    this.patchState({rate: clampedRate});
    this.getStorage()?.setItem(this.rateStorageKey, clampedRate.toString());
  }

  selectProvider(providerId: string): void {
    const provider = this.currentState.providers.find(p => p.id === providerId);
    if (!provider || !provider.available || provider.id === this.currentState.providerId) {
      return;
    }

    this.stop();
    this.patchState({
      providerId: provider.id,
      selectedVoiceId: this.getStoredVoice(provider.id),
      voices: [],
      error: null,
      isReady: false
    });

    this.getStorage()?.setItem(this.providerStorageKey, provider.id);
    void this.loadVoices();
  }

  selectVoice(voiceId: string | null): void {
    this.patchState({selectedVoiceId: voiceId});
    this.persistSelectedVoice(this.currentState.providerId, voiceId);
  }

  refreshVoicesForCurrentProvider(): void {
    if (!this.currentState.supported) {
      return;
    }
    void this.loadVoices();
  }

  private async bootstrap(): Promise<void> {
    await this.loadProviders();
    await this.loadVoices();
  }

  private async loadProviders(): Promise<void> {
    const providers: ReaderTtsProviderOption[] = [this.createBrowserProvider()];

    try {
      const response = await firstValueFrom(this.cloudApi.getProviders());
      const cloudProviders = response.providers.map(provider => this.mapCloudProvider(provider));
      providers.push(...cloudProviders);
    } catch {
      // Keep browser-only mode when cloud providers are unavailable.
    }

    const uniqueProviders = providers.filter((provider, index, list) =>
      list.findIndex(p => p.id === provider.id) === index
    );

    let providerId = this.currentState.providerId;
    if (!uniqueProviders.some(provider => provider.id === providerId && provider.available)) {
      providerId = uniqueProviders.find(provider => provider.available)?.id ?? this.browserProviderId;
    }

    const selectedVoiceId = this.getStoredVoice(providerId);

    this.patchState({
      providers: uniqueProviders,
      providerId,
      selectedVoiceId,
      supported: uniqueProviders.some(provider => provider.available)
    });

    this.getStorage()?.setItem(this.providerStorageKey, providerId);
  }

  private async loadVoices(): Promise<void> {
    const generation = ++this.voicesLoadGeneration;
    const providerId = this.currentState.providerId;

    this.patchState({loadingVoices: true, error: null});
    if (providerId === this.browserProviderId) {
      this.loadBrowserVoices(providerId, generation);
      return;
    }

    await this.loadCloudVoices(providerId, generation);
  }

  private async loadCloudVoices(providerId: string, generation: number): Promise<void> {
    try {
      const response = await firstValueFrom(this.cloudApi.getVoices(providerId));
      if (!this.isVoiceLoadCurrent(providerId, generation)) {
        return;
      }

      const mapped = response.voices
        .map(voice => this.mapCloudVoice(providerId, voice))
        .sort((a, b) =>
          Number(b.isNatural) - Number(a.isNatural)
          || b.qualityScore - a.qualityScore
          || a.name.localeCompare(b.name)
        );

      const uniqueVoices = mapped.filter((voice, index, list) =>
        list.findIndex(v => v.id === voice.id) === index
      );

      let selectedVoiceId = this.currentState.selectedVoiceId;
      if (selectedVoiceId && !uniqueVoices.some(voice => voice.id === selectedVoiceId)) {
        selectedVoiceId = null;
      }

      if (!selectedVoiceId && uniqueVoices.length > 0) {
        selectedVoiceId = response.provider.defaultVoiceId
          && uniqueVoices.some(voice => voice.id === response.provider.defaultVoiceId)
          ? response.provider.defaultVoiceId
          : uniqueVoices[0].id;
      }

      this.persistSelectedVoice(providerId, selectedVoiceId);

      this.patchState({
        voices: uniqueVoices,
        selectedVoiceId,
        loadingVoices: false,
        error: uniqueVoices.length ? null : 'No cloud voices are available for this provider.'
      });
    } catch {
      if (!this.isVoiceLoadCurrent(providerId, generation)) {
        return;
      }

      this.patchState({
        voices: [],
        selectedVoiceId: null,
        loadingVoices: false,
        error: 'Unable to load cloud voices. Check provider configuration.'
      });
    }
  }

  private loadBrowserVoices(providerId: string, generation: number): void {
    if (!this.isVoiceLoadCurrent(providerId, generation)) {
      return;
    }

    if (!this.speech) {
      this.patchState({
        voices: [],
        selectedVoiceId: null,
        loadingVoices: false,
        error: 'Browser text-to-speech is not available on this device.'
      });
      return;
    }

    const voices = this.speech.getVoices() ?? [];
    const mapped = voices
      .map(voice => this.mapBrowserVoice(voice))
      .sort((a, b) =>
        b.qualityScore - a.qualityScore
        || Number(b.isDefault) - Number(a.isDefault)
        || a.name.localeCompare(b.name)
      );

    const uniqueVoices = mapped.filter((voice, index, list) =>
      list.findIndex(v => v.id === voice.id) === index
    );

    const visibleVoices = this.filterNaturalVoices(uniqueVoices);

    let selectedVoiceId = this.currentState.selectedVoiceId;
    if (selectedVoiceId && !visibleVoices.some(voice => voice.id === selectedVoiceId)) {
      selectedVoiceId = null;
    }

    if (!selectedVoiceId && visibleVoices.length > 0) {
      selectedVoiceId = visibleVoices.find(voice => voice.isDefault)?.id ?? visibleVoices[0].id;
    }

    this.persistSelectedVoice(this.browserProviderId, selectedVoiceId);

    this.patchState({
      voices: visibleVoices,
      selectedVoiceId,
      loadingVoices: false,
      error: null
    });
  }

  private isVoiceLoadCurrent(providerId: string, generation: number): boolean {
    return generation === this.voicesLoadGeneration && providerId === this.currentState.providerId;
  }

  private async startFromCurrentInternal(): Promise<void> {
    try {
      await this.ensureReady();
      const tts = this.getTtsController();
      const ssml = tts?.start?.();
      this.startFromSsml(ssml);
    } catch {
      this.handleError('Unable to start text-to-speech.');
    }
  }

  private async startFromSelectionInternal(range: Range): Promise<void> {
    try {
      await this.ensureReady();
      const tts = this.getTtsController();
      const ssml = tts?.from?.(range);
      this.startFromSsml(ssml);
    } catch {
      this.handleError('Unable to read selected text.');
    }
  }

  private async jump(direction: 'next' | 'prev'): Promise<void> {
    try {
      await this.ensureReady();
      const tts = this.getTtsController();
      const ssml = direction === 'next' ? tts?.next?.() : tts?.prev?.();
      this.startFromSsml(ssml);
    } catch {
      this.handleError('Unable to change TTS position.');
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.currentState.supported) {
      throw new Error('No TTS providers are available');
    }
    this.initialize();
    await firstValueFrom(this.viewManager.initTts('sentence'));
    this.patchState({isReady: true, error: null});
  }

  private startFromSsml(ssml?: string): void {
    this.cancelSpeech(true);

    if (!ssml) {
      this.patchState({isPlaying: false, isPaused: false});
      return;
    }

    this.currentSegments = this.parseSsmlSegments(ssml);
    this.currentSegmentIndex = 0;

    if (this.currentSegments.length === 0) {
      this.patchState({isPlaying: false, isPaused: false});
      return;
    }

    const generation = this.playbackGeneration;
    this.patchState({isPlaying: true, isPaused: false, error: null});
    this.speakCurrentSegment(generation);
  }

  private speakCurrentSegment(generation: number): void {
    if (generation !== this.playbackGeneration) {
      return;
    }

    if (this.isCloudProviderSelected()) {
      void this.speakCurrentSegmentCloud(generation);
      return;
    }

    this.speakCurrentSegmentBrowser(generation);
  }

  private speakCurrentSegmentBrowser(generation: number): void {
    if (!this.speech || generation !== this.playbackGeneration) {
      return;
    }

    const segment = this.currentSegments[this.currentSegmentIndex];
    if (!segment) {
      this.advanceToNextChunk(generation);
      return;
    }

    if (segment.mark) {
      this.getTtsController()?.setMark?.(segment.mark);
    }

    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.rate = this.currentState.rate;

    const voice = this.resolveBrowserVoice(segment.lang);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || segment.lang || '';
    } else if (segment.lang) {
      utterance.lang = segment.lang;
    }

    utterance.onend = () => {
      if (generation !== this.playbackGeneration) {
        return;
      }
      this.currentSegmentIndex += 1;
      if (this.currentSegmentIndex < this.currentSegments.length) {
        this.speakCurrentSegment(generation);
      } else {
        this.advanceToNextChunk(generation);
      }
    };

    utterance.onerror = () => {
      if (generation !== this.playbackGeneration) {
        return;
      }
      this.handleError('Speech synthesis failed for the current segment.');
    };

    this.speech.cancel();
    this.speech.speak(utterance);
  }

  private async speakCurrentSegmentCloud(generation: number): Promise<void> {
    if (generation !== this.playbackGeneration) {
      return;
    }

    const segment = this.currentSegments[this.currentSegmentIndex];
    if (!segment) {
      this.advanceToNextChunk(generation);
      return;
    }

    if (segment.mark) {
      this.getTtsController()?.setMark?.(segment.mark);
    }

    try {
      const blob = await this.synthesizeCloudSegment(segment);
      if (generation !== this.playbackGeneration) {
        return;
      }

      await this.playCloudAudioBlob(blob);
      if (generation !== this.playbackGeneration) {
        return;
      }

      this.currentSegmentIndex += 1;
      if (this.currentSegmentIndex < this.currentSegments.length) {
        this.speakCurrentSegment(generation);
      } else {
        this.advanceToNextChunk(generation);
      }
    } catch {
      if (generation !== this.playbackGeneration) {
        return;
      }
      this.handleError('Cloud speech synthesis failed for the current segment.');
    }
  }

  private async synthesizeCloudSegment(segment: TtsSegment): Promise<Blob> {
    const providerId = this.currentState.providerId;
    const voice = this.currentState.voices.find(v => v.id === this.currentState.selectedVoiceId);

    const blob = await firstValueFrom(this.cloudApi.synthesize({
      provider: providerId,
      text: segment.text,
      voiceId: this.currentState.selectedVoiceId,
      language: segment.lang || voice?.lang || null,
      rate: this.currentState.rate
    }));

    if (!blob || blob.size === 0) {
      throw new Error('Cloud synthesis returned an empty audio payload');
    }

    return blob;
  }

  private async playCloudAudioBlob(blob: Blob): Promise<void> {
    if (!this.audioElement) {
      throw new Error('Audio playback is not available');
    }

    const audio = this.audioElement;
    this.releaseActiveAudioUrl();

    audio.pause();
    audio.currentTime = 0;

    this.activeAudioUrl = URL.createObjectURL(blob);
    audio.src = this.activeAudioUrl;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
      };

      audio.onended = () => {
        cleanup();
        resolve();
      };

      audio.onerror = () => {
        cleanup();
        reject(new Error('Cloud audio playback failed'));
      };

      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(err => {
          cleanup();
          reject(err);
        });
      }
    });
  }

  private toggleCloudPause(): void {
    if (!this.audioElement) {
      return;
    }

    if (this.currentState.isPaused) {
      void this.audioElement.play()
        .then(() => this.patchState({isPaused: false, error: null}))
        .catch(() => this.handleError('Unable to resume cloud audio playback.'));
      return;
    }

    this.audioElement.pause();
    this.patchState({isPaused: true, error: null});
  }

  private advanceToNextChunk(generation: number): void {
    if (generation !== this.playbackGeneration) {
      return;
    }

    const tts = this.getTtsController();
    const nextSsml = tts?.next?.();
    if (!nextSsml) {
      this.patchState({
        isPlaying: false,
        isPaused: false
      });
      return;
    }

    this.currentSegments = this.parseSsmlSegments(nextSsml);
    this.currentSegmentIndex = 0;
    if (this.currentSegments.length === 0) {
      this.advanceToNextChunk(generation);
      return;
    }

    this.speakCurrentSegment(generation);
  }

  private parseSsmlSegments(ssml: string): TtsSegment[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ssml, 'application/xml');
    const root = doc.documentElement;

    if (!root || root.localName === 'parsererror') {
      const plainText = this.stripTags(ssml).trim();
      return plainText ? [{mark: null, text: plainText}] : [];
    }

    const segments: TtsSegment[] = [];
    let currentMark: string | null = null;
    let buffer = '';
    let bufferLang: string | undefined;

    const flush = () => {
      const normalized = buffer.replace(/\s+/g, ' ').trim();
      if (normalized) {
        segments.push({mark: currentMark, text: normalized, lang: bufferLang});
      }
      buffer = '';
      bufferLang = undefined;
    };

    const walk = (node: Node, inheritedLang?: string) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const nodeLang = element.getAttribute('lang')
          || element.getAttribute('xml:lang')
          || element.getAttributeNS(this.xmlLangNs, 'lang')
          || inheritedLang;

        if (element.localName === 'mark') {
          flush();
          currentMark = element.getAttribute('name');
          return;
        }

        if (element.localName === 'break') {
          buffer += ' ';
          if (!bufferLang && nodeLang) {
            bufferLang = nodeLang;
          }
          return;
        }

        for (let i = 0; i < element.childNodes.length; i++) {
          walk(element.childNodes[i], nodeLang);
        }
        return;
      }

      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        const value = node.nodeValue ?? '';
        buffer += value;
        if (!bufferLang && inheritedLang) {
          bufferLang = inheritedLang;
        }
      }
    };

    walk(root, undefined);
    flush();

    return segments;
  }

  private resolveBrowserVoice(segmentLang?: string): SpeechSynthesisVoice | null {
    if (!this.speech) {
      return null;
    }

    const voices = this.getPreferredBrowserVoices();
    if (!voices.length) {
      return null;
    }

    const selectedVoiceId = this.currentState.selectedVoiceId;
    if (selectedVoiceId) {
      const selectedVoice = voices.find(voice => this.getVoiceId(voice) === selectedVoiceId);
      if (selectedVoice) {
        return selectedVoice;
      }
    }

    if (segmentLang) {
      const normalized = segmentLang.toLowerCase();
      const direct = voices.find(voice => voice.lang?.toLowerCase() === normalized);
      if (direct) {
        return direct;
      }
      const base = normalized.split('-')[0];
      const sameBase = voices.find(voice =>
        voice.lang?.toLowerCase().startsWith(`${base}-`) || voice.lang?.toLowerCase() === base
      );
      if (sameBase) {
        return sameBase;
      }
    }

    const defaultVoice = voices.find(voice => voice.default);
    return defaultVoice ?? voices[0] ?? null;
  }

  private getPreferredBrowserVoices(): SpeechSynthesisVoice[] {
    if (!this.speech) {
      return [];
    }

    const voices = this.speech.getVoices() ?? [];
    if (!voices.length) {
      return [];
    }

    const ranked = voices
      .map(voice => ({voice, mapped: this.mapBrowserVoice(voice)}))
      .sort((a, b) =>
        b.mapped.qualityScore - a.mapped.qualityScore
        || Number(b.mapped.isDefault) - Number(a.mapped.isDefault)
      );

    const natural = ranked.filter(entry => !entry.mapped.isNovelty).map(entry => entry.voice);
    return natural.length > 0 ? natural : ranked.map(entry => entry.voice);
  }

  private filterNaturalVoices(voices: ReaderTtsVoice[]): ReaderTtsVoice[] {
    const naturalVoices = voices.filter(voice => !voice.isNovelty);
    return naturalVoices.length > 0 ? naturalVoices : voices;
  }

  private mapBrowserVoice(voice: SpeechSynthesisVoice): ReaderTtsVoice {
    const name = voice.name || '';
    const lang = voice.lang || '';
    const normalizedName = name.toLowerCase();
    const normalizedLang = lang.toLowerCase();
    const isNovelty = this.isNoveltyVoiceName(normalizedName);

    let qualityScore = 0;
    if (voice.default) qualityScore += 8;
    if (voice.localService) qualityScore += 1;
    if (normalizedLang.startsWith('en')) qualityScore += 3;
    if (/(neural|natural|wavenet|enhanced|premium|studio|pro)/.test(normalizedName)) qualityScore += 6;
    if (/(compact|legacy|novelty|fun)/.test(normalizedName)) qualityScore -= 4;
    if (isNovelty) qualityScore -= 80;

    return {
      id: this.getVoiceId(voice),
      name,
      lang,
      isDefault: !!voice.default,
      isNovelty,
      qualityScore,
      providerId: this.browserProviderId,
      isNatural: !isNovelty
    };
  }

  private mapCloudProvider(provider: ReaderCloudTtsProvider): ReaderTtsProviderOption {
    return {
      id: provider.id,
      label: provider.label,
      type: 'cloud',
      available: provider.available,
      unavailableReason: provider.unavailableReason ?? null
    };
  }

  private mapCloudVoice(providerId: string, voice: ReaderCloudTtsVoice): ReaderTtsVoice {
    return {
      id: voice.id,
      name: voice.name,
      lang: voice.language,
      isDefault: false,
      isNovelty: false,
      qualityScore: (voice.natural ? 20 : 8) + (voice.sampleRateHz ? Math.round(voice.sampleRateHz / 10000) : 0),
      providerId,
      isNatural: voice.natural
    };
  }

  private isNoveltyVoiceName(normalizedName: string): boolean {
    const compact = normalizedName
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return this.noveltyVoiceNames.some(keyword =>
      compact === keyword
      || compact.startsWith(`${keyword} `)
      || compact.endsWith(` ${keyword}`)
      || compact.includes(` ${keyword} `)
      || compact.includes(`${keyword}-`)
      || compact.includes(`-${keyword}`)
    );
  }

  private persistSelectedVoice(providerId: string, voiceId: string | null): void {
    const storage = this.getStorage();
    if (!storage) {
      return;
    }

    const key = `${this.voiceStorageKeyPrefix}${providerId}`;
    if (voiceId) {
      storage.setItem(key, voiceId);
    } else {
      storage.removeItem(key);
    }
  }

  private getStoredVoice(providerId: string): string | null {
    return this.getStorage()?.getItem(`${this.voiceStorageKeyPrefix}${providerId}`) ?? null;
  }

  private cancelSpeech(incrementGeneration: boolean): void {
    if (incrementGeneration) {
      this.playbackGeneration += 1;
    }

    this.currentSegments = [];
    this.currentSegmentIndex = 0;

    if (this.speech) {
      this.speech.cancel();
    }

    if (this.audioElement) {
      this.audioElement.onended = null;
      this.audioElement.onerror = null;
      this.audioElement.pause();
      this.audioElement.src = '';
    }
    this.releaseActiveAudioUrl();
  }

  private releaseActiveAudioUrl(): void {
    if (!this.activeAudioUrl) {
      return;
    }
    URL.revokeObjectURL(this.activeAudioUrl);
    this.activeAudioUrl = null;
  }

  private isBrowserSynthesisAvailable(): boolean {
    return !!this.speech && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  private createBrowserProvider(): ReaderTtsProviderOption {
    return {
      id: this.browserProviderId,
      label: 'Browser Voices',
      type: 'browser',
      available: this.isBrowserSynthesisAvailable(),
      unavailableReason: this.isBrowserSynthesisAvailable() ? null : 'Browser speech synthesis is unavailable'
    };
  }

  private isCloudProviderSelected(): boolean {
    return this.currentState.providerId !== this.browserProviderId;
  }

  private getTtsController(): any | null {
    return this.viewManager.getView()?.tts ?? null;
  }

  private getVoiceId(voice: SpeechSynthesisVoice): string {
    return voice.voiceURI || voice.name;
  }

  private stripTags(input: string): string {
    return input.replace(/<[^>]+>/g, ' ');
  }

  private getStorage(): Storage | null {
    return typeof window !== 'undefined' ? window.localStorage : null;
  }

  private handleError(message: string): void {
    this.cancelSpeech(true);
    this.patchState({
      isPlaying: false,
      isPaused: false,
      error: message
    });
  }

  private patchState(patch: Partial<ReaderTtsState>): void {
    this.stateSubject.next({
      ...this.currentState,
      ...patch
    });
  }
}
