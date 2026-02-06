package org.booklore.service.tts;

import org.booklore.model.dto.response.tts.TtsProviderInfoResponse;
import org.booklore.model.dto.response.tts.TtsVoiceResponse;

import java.util.List;

public interface TtsProviderClient {

    String getId();

    String getLabel();

    boolean isConfigured();

    String getUnavailableReason();

    String getDefaultVoiceId();

    List<TtsVoiceResponse> listVoices(String language);

    TtsSynthesisResult synthesize(String text, String voiceId, String language, double rate);

    default TtsProviderInfoResponse toProviderInfo() {
        return new TtsProviderInfoResponse(
                getId(),
                getLabel(),
                isConfigured(),
                isConfigured() ? null : getUnavailableReason(),
                getDefaultVoiceId()
        );
    }
}
