package org.booklore.service.tts;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.booklore.config.TtsProperties;
import org.booklore.model.dto.response.tts.TtsVoiceResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

@Slf4j
@Service
@RequiredArgsConstructor
public class GoogleTtsProviderClient implements TtsProviderClient {
    private static final String GOOGLE_API_KEY_HEADER = "X-Goog-Api-Key";

    private final TtsProperties properties;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    @Override
    public String getId() {
        return "google";
    }

    @Override
    public String getLabel() {
        return "Google Cloud";
    }

    @Override
    public boolean isConfigured() {
        return properties.isEnabled()
                && properties.getGoogle().isEnabled()
                && StringUtils.hasText(properties.getGoogle().getApiKey())
                && StringUtils.hasText(resolveBaseUrl());
    }

    @Override
    public String getUnavailableReason() {
        if (!properties.isEnabled()) {
            return "TTS is globally disabled";
        }
        if (!properties.getGoogle().isEnabled()) {
            return "Google TTS is disabled";
        }
        if (!StringUtils.hasText(properties.getGoogle().getApiKey())) {
            return "Missing Google API key";
        }
        if (!StringUtils.hasText(resolveBaseUrl())) {
            return "Missing Google endpoint";
        }
        return "Unavailable";
    }

    @Override
    public String getDefaultVoiceId() {
        return properties.getGoogle().getDefaultVoice();
    }

    @Override
    public List<TtsVoiceResponse> listVoices(String language) {
        String response = restClient.get()
                .uri(resolveBaseUrl() + "/v1/voices")
                .header(GOOGLE_API_KEY_HEADER, properties.getGoogle().getApiKey())
                .retrieve()
                .body(String.class);

        if (!StringUtils.hasText(response)) {
            return List.of();
        }

        try {
            JsonNode root = objectMapper.readTree(response);
            JsonNode voicesNode = root.path("voices");
            if (!voicesNode.isArray()) {
                return List.of();
            }

            List<TtsVoiceResponse> allVoices = new ArrayList<>();
            for (JsonNode voiceNode : voicesNode) {
                String name = voiceNode.path("name").asText("");
                if (!StringUtils.hasText(name)) {
                    continue;
                }

                JsonNode languageCodes = voiceNode.path("languageCodes");
                String lang = (languageCodes.isArray() && !languageCodes.isEmpty())
                        ? languageCodes.get(0).asText("")
                        : "";

                String gender = voiceNode.path("ssmlGender").asText("");
                Integer sampleRate = voiceNode.path("naturalSampleRateHertz").isInt()
                        ? voiceNode.path("naturalSampleRateHertz").intValue()
                        : null;

                String normalized = name.toLowerCase(Locale.ROOT);
                boolean natural = normalized.contains("neural2")
                        || normalized.contains("wavenet")
                        || normalized.contains("chirp")
                        || normalized.contains("studio")
                        || normalized.contains("journey");

                allVoices.add(new TtsVoiceResponse(name, name, lang, gender, natural, sampleRate));
            }

            List<TtsVoiceResponse> filtered = filterByLanguage(allVoices, language);
            List<TtsVoiceResponse> naturalFirst = keepNaturalWhenAvailable(filtered);

            return naturalFirst.stream()
                    .sorted(Comparator.comparing(TtsVoiceResponse::language)
                            .thenComparing(TtsVoiceResponse::name))
                    .toList();
        } catch (Exception e) {
            log.warn("Failed to parse Google voices list: {}", e.getMessage());
            return List.of();
        }
    }

    @Override
    public TtsSynthesisResult synthesize(String text, String voiceId, String language, double rate) {
        String resolvedVoice = StringUtils.hasText(voiceId) ? voiceId : properties.getGoogle().getDefaultVoice();

        ObjectNode requestBody = objectMapper.createObjectNode();
        requestBody.putObject("input").put("text", text);

        ObjectNode voice = requestBody.putObject("voice");
        if (StringUtils.hasText(resolvedVoice)) {
            voice.put("name", resolvedVoice);
        }
        String resolvedLanguage = StringUtils.hasText(language)
                ? language
                : inferLanguageFromVoice(resolvedVoice);
        if (StringUtils.hasText(resolvedLanguage)) {
            voice.put("languageCode", resolvedLanguage);
        }

        ObjectNode audioConfig = requestBody.putObject("audioConfig");
        audioConfig.put("audioEncoding", "MP3");
        audioConfig.put("speakingRate", clampRate(rate));

        String response = restClient.post()
                .uri(resolveBaseUrl() + "/v1/text:synthesize")
                .header(GOOGLE_API_KEY_HEADER, properties.getGoogle().getApiKey())
                .header("Content-Type", "application/json")
                .body(requestBody.toString())
                .retrieve()
                .body(String.class);

        if (!StringUtils.hasText(response)) {
            throw new IllegalStateException("Google TTS returned empty response");
        }

        try {
            JsonNode root = objectMapper.readTree(response);
            String audioContent = root.path("audioContent").asText("");
            if (!StringUtils.hasText(audioContent)) {
                throw new IllegalStateException("Google TTS response did not include audioContent");
            }
            return new TtsSynthesisResult(Base64.getDecoder().decode(audioContent), "audio/mpeg");
        } catch (Exception e) {
            throw new IllegalStateException("Unable to decode Google TTS response", e);
        }
    }

    private List<TtsVoiceResponse> filterByLanguage(List<TtsVoiceResponse> voices, String language) {
        if (!StringUtils.hasText(language)) {
            return voices;
        }
        String normalized = language.toLowerCase(Locale.ROOT);
        List<TtsVoiceResponse> languageMatches = voices.stream()
                .filter(v -> v.language() != null && v.language().toLowerCase(Locale.ROOT).startsWith(normalized))
                .toList();
        return languageMatches.isEmpty() ? voices : languageMatches;
    }

    private List<TtsVoiceResponse> keepNaturalWhenAvailable(List<TtsVoiceResponse> voices) {
        List<TtsVoiceResponse> natural = voices.stream().filter(TtsVoiceResponse::natural).toList();
        return natural.isEmpty() ? voices : natural;
    }

    private String inferLanguageFromVoice(String voice) {
        if (!StringUtils.hasText(voice)) {
            return "en-US";
        }
        String[] parts = voice.split("-");
        if (parts.length >= 2) {
            return parts[0] + "-" + parts[1];
        }
        return "en-US";
    }

    private double clampRate(double rate) {
        return Math.max(0.5, Math.min(3.0, rate));
    }

    private String resolveBaseUrl() {
        if (!StringUtils.hasText(properties.getGoogle().getEndpoint())) {
            return null;
        }
        String endpoint = properties.getGoogle().getEndpoint().trim();
        while (endpoint.endsWith("/")) {
            endpoint = endpoint.substring(0, endpoint.length() - 1);
        }
        return endpoint;
    }
}
