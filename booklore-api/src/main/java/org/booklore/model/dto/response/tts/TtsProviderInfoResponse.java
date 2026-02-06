package org.booklore.model.dto.response.tts;

public record TtsProviderInfoResponse(
        String id,
        String label,
        boolean available,
        String unavailableReason,
        String defaultVoiceId
) {
}
