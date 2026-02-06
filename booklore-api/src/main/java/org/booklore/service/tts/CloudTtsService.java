package org.booklore.service.tts;

import org.booklore.config.TtsProperties;
import org.booklore.exception.ApiError;
import org.booklore.model.dto.request.tts.TtsSynthesisRequest;
import org.booklore.model.dto.response.tts.TtsProviderInfoResponse;
import org.booklore.model.dto.response.tts.TtsProviderVoicesResponse;
import org.booklore.model.dto.response.tts.TtsProvidersResponse;
import org.booklore.model.dto.response.tts.TtsVoiceResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
public class CloudTtsService {

    private final TtsProperties ttsProperties;
    private final Map<String, TtsProviderClient> providers;

    public CloudTtsService(TtsProperties ttsProperties, List<TtsProviderClient> providerClients) {
        this.ttsProperties = ttsProperties;
        this.providers = providerClients.stream()
                .collect(Collectors.toMap(client -> client.getId().toLowerCase(), Function.identity()));
    }

    public TtsProvidersResponse getProviders() {
        List<TtsProviderInfoResponse> providerInfos = providers.values().stream()
                .map(TtsProviderClient::toProviderInfo)
                .sorted(Comparator.comparing(TtsProviderInfoResponse::label))
                .toList();
        return new TtsProvidersResponse(providerInfos);
    }

    public TtsProviderVoicesResponse getVoices(String providerId, String language) {
        TtsProviderClient provider = getConfiguredProvider(providerId);
        List<TtsVoiceResponse> voices = provider.listVoices(language);
        return new TtsProviderVoicesResponse(provider.toProviderInfo(), voices);
    }

    public TtsSynthesisResult synthesize(TtsSynthesisRequest request) {
        if (!ttsProperties.isEnabled()) {
            throw ApiError.TTS_PROVIDER_NOT_CONFIGURED.createException("disabled");
        }

        TtsProviderClient provider = getConfiguredProvider(request.getProvider());

        String text = request.getText() == null ? "" : request.getText().trim();
        if (!StringUtils.hasText(text)) {
            throw ApiError.GENERIC_BAD_REQUEST.createException("TTS text cannot be empty");
        }
        if (text.length() > ttsProperties.getMaxTextLength()) {
            throw ApiError.TTS_TEXT_TOO_LONG.createException(ttsProperties.getMaxTextLength());
        }

        double rate = request.getRate() == null ? 1.0 : request.getRate();
        try {
            return provider.synthesize(text, request.getVoiceId(), request.getLanguage(), rate);
        } catch (Exception e) {
            log.warn("TTS synthesis failed for provider {}: {}", provider.getId(), e.getMessage());
            throw ApiError.TTS_SYNTHESIS_FAILED.createException(provider.getId());
        }
    }

    private TtsProviderClient getConfiguredProvider(String providerId) {
        if (!StringUtils.hasText(providerId)) {
            throw ApiError.TTS_PROVIDER_NOT_SUPPORTED.createException("(empty)");
        }

        TtsProviderClient provider = providers.get(providerId.toLowerCase());
        if (provider == null) {
            throw ApiError.TTS_PROVIDER_NOT_SUPPORTED.createException(providerId);
        }

        if (!provider.isConfigured()) {
            throw ApiError.TTS_PROVIDER_NOT_CONFIGURED.createException(provider.getId());
        }

        return provider;
    }
}
