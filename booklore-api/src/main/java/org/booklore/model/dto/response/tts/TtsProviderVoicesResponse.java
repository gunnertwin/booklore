package org.booklore.model.dto.response.tts;

import java.util.List;

public record TtsProviderVoicesResponse(
        TtsProviderInfoResponse provider,
        List<TtsVoiceResponse> voices
) {
}
