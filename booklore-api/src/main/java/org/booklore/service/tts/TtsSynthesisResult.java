package org.booklore.service.tts;

public record TtsSynthesisResult(byte[] audio, String contentType) {
}
