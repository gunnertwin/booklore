package org.booklore.service.tts;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.booklore.config.TtsProperties;
import org.booklore.model.dto.response.tts.TtsVoiceResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class PiperTtsProviderClient implements TtsProviderClient {

    private final TtsProperties properties;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    @Override
    public String getId() {
        return "piper";
    }

    @Override
    public String getLabel() {
        return "Piper Local";
    }

    @Override
    public boolean isConfigured() {
        return properties.isEnabled()
                && properties.getPiper().isEnabled()
                && StringUtils.hasText(resolveBaseUrl());
    }

    @Override
    public String getUnavailableReason() {
        if (!properties.isEnabled()) {
            return "TTS is globally disabled";
        }
        if (!properties.getPiper().isEnabled()) {
            return "Piper TTS is disabled";
        }
        if (!StringUtils.hasText(resolveBaseUrl())) {
            return "Missing Piper base URL";
        }
        return "Unavailable";
    }

    @Override
    public String getDefaultVoiceId() {
        return properties.getPiper().getDefaultVoice();
    }

    @Override
    public List<TtsVoiceResponse> listVoices(String language) {
        String response = restClient.get()
                .uri(resolveBaseUrl() + "/voices")
                .retrieve()
                .body(String.class);

        if (!StringUtils.hasText(response)) {
            return List.of();
        }

        try {
            JsonNode root = objectMapper.readTree(response);
            List<TtsVoiceResponse> voices = new ArrayList<>();

            if (root.isObject()) {
                for (Map.Entry<String, JsonNode> entry : iterable(root.fields())) {
                    String id = entry.getKey();
                    JsonNode node = entry.getValue();
                    voices.add(mapVoice(id, node));
                }
            } else if (root.isArray()) {
                for (JsonNode node : root) {
                    String id = node.path("id").asText(node.path("name").asText(""));
                    if (!StringUtils.hasText(id)) {
                        continue;
                    }
                    voices.add(mapVoice(id, node));
                }
            }

            List<TtsVoiceResponse> filtered = filterByLanguage(voices, language);
            return filtered.stream()
                    .sorted(Comparator.comparing(TtsVoiceResponse::language)
                            .thenComparing(TtsVoiceResponse::name))
                    .toList();
        } catch (Exception e) {
            log.warn("Failed to parse Piper voices list");
            log.debug("Piper voices parse error", e);
            return List.of();
        }
    }

    @Override
    public TtsSynthesisResult synthesize(String text, String voiceId, String language, double rate) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("text", text);

        String resolvedVoice = StringUtils.hasText(voiceId) ? voiceId : properties.getPiper().getDefaultVoice();
        if (StringUtils.hasText(resolvedVoice)) {
            payload.put("voice", resolvedVoice);
        }

        // Piper uses length_scale (lower=faster). Reader rate uses higher=faster.
        payload.put("length_scale", clampLengthScaleFromRate(rate));

        byte[] audio = restClient.post()
                .uri(resolveBaseUrl() + "/")
                .contentType(MediaType.APPLICATION_JSON)
                .body(payload.toString())
                .retrieve()
                .body(byte[].class);

        return new TtsSynthesisResult(audio, "audio/wav");
    }

    private TtsVoiceResponse mapVoice(String id, JsonNode node) {
        String name = node.path("name").asText(humanizeVoiceId(id));
        Integer sampleRate = node.path("sample_rate").isInt() ? node.path("sample_rate").intValue() : null;

        String language = node.path("language").asText("");
        if (!StringUtils.hasText(language)) {
            language = inferLanguageFromVoiceId(id);
        }

        return new TtsVoiceResponse(
                id,
                name,
                language,
                "",
                true,
                sampleRate
        );
    }

    private String humanizeVoiceId(String id) {
        String compact = id
                .replace(".onnx", "")
                .replace("_", " ")
                .replace("-", " ")
                .trim();
        if (!StringUtils.hasText(compact)) {
            return id;
        }
        return compact.substring(0, 1).toUpperCase(Locale.ROOT) + compact.substring(1);
    }

    private String inferLanguageFromVoiceId(String voiceId) {
        if (!StringUtils.hasText(voiceId)) {
            return "";
        }

        String normalized = voiceId.toLowerCase(Locale.ROOT);
        if (normalized.length() >= 5 && normalized.charAt(2) == '_') {
            return normalized.substring(0, 2) + "-" + normalized.substring(3, 5).toUpperCase(Locale.ROOT);
        }
        if (normalized.length() >= 5 && normalized.charAt(2) == '-') {
            return normalized.substring(0, 2) + "-" + normalized.substring(3, 5).toUpperCase(Locale.ROOT);
        }
        return "";
    }

    private double clampLengthScaleFromRate(double rate) {
        double normalizedRate = Math.max(0.5, Math.min(3.0, rate));
        double lengthScale = 1.0 / normalizedRate;
        return Math.max(0.33, Math.min(2.0, lengthScale));
    }

    private List<TtsVoiceResponse> filterByLanguage(List<TtsVoiceResponse> voices, String language) {
        if (!StringUtils.hasText(language)) {
            return voices;
        }

        String normalized = language.toLowerCase(Locale.ROOT);
        List<TtsVoiceResponse> matches = voices.stream()
                .filter(voice -> voice.language() != null && voice.language().toLowerCase(Locale.ROOT).startsWith(normalized))
                .toList();

        return matches.isEmpty() ? voices : matches;
    }

    private String resolveBaseUrl() {
        if (!StringUtils.hasText(properties.getPiper().getBaseUrl())) {
            return null;
        }
        String endpoint = properties.getPiper().getBaseUrl().trim();
        while (endpoint.endsWith("/")) {
            endpoint = endpoint.substring(0, endpoint.length() - 1);
        }
        return endpoint;
    }

    private <T> Iterable<T> iterable(java.util.Iterator<T> iterator) {
        return () -> iterator;
    }
}
