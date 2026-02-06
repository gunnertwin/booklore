import {inject, Injectable} from '@angular/core';
import {HttpClient, HttpParams} from '@angular/common/http';
import {Observable} from 'rxjs';
import {API_CONFIG} from '../../../../../core/config/api-config';

export interface ReaderCloudTtsProvider {
  id: string;
  label: string;
  available: boolean;
  unavailableReason: string | null;
  defaultVoiceId: string | null;
}

export interface ReaderCloudTtsVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
  natural: boolean;
  sampleRateHz: number | null;
}

interface ReaderCloudTtsProvidersResponse {
  providers: ReaderCloudTtsProvider[];
}

interface ReaderCloudTtsVoicesResponse {
  provider: ReaderCloudTtsProvider;
  voices: ReaderCloudTtsVoice[];
}

export interface ReaderCloudSynthesizeRequest {
  provider: string;
  text: string;
  voiceId: string | null;
  language: string | null;
  rate: number;
}

@Injectable({providedIn: 'root'})
export class ReaderCloudTtsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.BASE_URL}/api/v1/tts`;

  getProviders(): Observable<ReaderCloudTtsProvidersResponse> {
    return this.http.get<ReaderCloudTtsProvidersResponse>(`${this.baseUrl}/providers`);
  }

  getVoices(providerId: string, language?: string): Observable<ReaderCloudTtsVoicesResponse> {
    let params = new HttpParams();
    if (language) {
      params = params.set('language', language);
    }

    return this.http.get<ReaderCloudTtsVoicesResponse>(`${this.baseUrl}/providers/${providerId}/voices`, {params});
  }

  synthesize(request: ReaderCloudSynthesizeRequest): Observable<Blob> {
    return this.http.post(`${this.baseUrl}/synthesize`, request, {
      responseType: 'blob'
    });
  }
}
