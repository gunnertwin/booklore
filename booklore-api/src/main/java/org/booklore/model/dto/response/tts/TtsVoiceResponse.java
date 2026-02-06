package org.booklore.model.dto.response.tts;

public record TtsVoiceResponse(
        String id,
        String name,
        String language,
        String gender,
        boolean natural,
        Integer sampleRateHz
) {
}
