package org.booklore.service.tts;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.booklore.config.TtsProperties;
import org.booklore.model.dto.response.tts.TtsVoiceResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

@Slf4j
@Service
@RequiredArgsConstructor
public class AzureTtsProviderClient implements TtsProviderClient {

    private final TtsProperties properties;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    @Override
    public String getId() {
        return "azure";
    }

    @Override
    public String getLabel() {
        return "Azure Neural";
    }

    @Override
    public boolean isConfigured() {
        return properties.isEnabled()
                && properties.getAzure().isEnabled()
                && StringUtils.hasText(properties.getAzure().getApiKey())
                && StringUtils.hasText(resolveBaseUrl());
    }

    @Override
    public String getUnavailableReason() {
        if (!properties.isEnabled()) {
            return "TTS is globally disabled";
        }
        if (!properties.getAzure().isEnabled()) {
            return "Azure TTS is disabled";
        }
        if (!StringUtils.hasText(properties.getAzure().getApiKey())) {
            return "Missing Azure API key";
        }
        if (!StringUtils.hasText(resolveBaseUrl())) {
            return "Missing Azure region or endpoint";
        }
        return "Unavailable";
    }

    @Override
    public String getDefaultVoiceId() {
        return properties.getAzure().getDefaultVoice();
    }

    @Override
    public List<TtsVoiceResponse> listVoices(String language) {
        String response = restClient.get()
                .uri(resolveBaseUrl() + "/cognitiveservices/voices/list")
                .header("Ocp-Apim-Subscription-Key", properties.getAzure().getApiKey())
                .retrieve()
                .body(String.class);

        if (!StringUtils.hasText(response)) {
            return List.of();
        }

        try {
            JsonNode root = objectMapper.readTree(response);
            if (!root.isArray()) {
                return List.of();
            }

            List<TtsVoiceResponse> allVoices = new ArrayList<>();
            for (JsonNode voiceNode : root) {
                String id = voiceNode.path("ShortName").asText("");
                if (!StringUtils.hasText(id)) {
                    continue;
                }

                String locale = voiceNode.path("Locale").asText("");
                String displayName = voiceNode.path("DisplayName").asText(id);
                String gender = voiceNode.path("Gender").asText("");
                String voiceType = voiceNode.path("VoiceType").asText("");
                Integer sampleRate = parseInteger(voiceNode.path("SampleRateHertz").asText(null));

                boolean natural = "Neural".equalsIgnoreCase(voiceType)
                        || id.toLowerCase(Locale.ROOT).contains("neural");

                allVoices.add(new TtsVoiceResponse(id, displayName, locale, gender, natural, sampleRate));
            }

            List<TtsVoiceResponse> filtered = filterByLanguage(allVoices, language);
            List<TtsVoiceResponse> naturalFirst = keepNaturalWhenAvailable(filtered);

            return naturalFirst.stream()
                    .sorted(Comparator.comparing(TtsVoiceResponse::language)
                            .thenComparing(TtsVoiceResponse::name))
                    .toList();
        } catch (Exception e) {
            log.warn("Failed to parse Azure voices list");
            log.debug("Azure voices parse error", e);
            return List.of();
        }
    }

    @Override
    public TtsSynthesisResult synthesize(String text, String voiceId, String language, double rate) {
        String resolvedVoice = StringUtils.hasText(voiceId) ? voiceId : properties.getAzure().getDefaultVoice();
        String resolvedLanguage = StringUtils.hasText(language) ? language : inferLanguageFromVoice(resolvedVoice);
        String contentType = resolveContentType(properties.getAzure().getOutputFormat());

        String ssml = buildSsml(text, resolvedVoice, resolvedLanguage, rate);

        byte[] audio = restClient.post()
                .uri(resolveBaseUrl() + "/cognitiveservices/v1")
                .header("Ocp-Apim-Subscription-Key", properties.getAzure().getApiKey())
                .header("X-Microsoft-OutputFormat", properties.getAzure().getOutputFormat())
                .header("User-Agent", "Booklore-TTS")
                .header("Accept", contentType)
                .header("Content-Type", "application/ssml+xml")
                .body(ssml)
                .retrieve()
                .body(byte[].class);
        return new TtsSynthesisResult(audio, contentType);
    }

    private String buildSsml(String text, String voiceName, String language, double rate) {
        String safeVoice = escapeXml(StringUtils.hasText(voiceName) ? voiceName : properties.getAzure().getDefaultVoice());
        String safeLanguage = escapeXml(StringUtils.hasText(language) ? language : "en-US");
        String safeText = escapeXml(text);

        int percent = (int) Math.round((clampRate(rate) - 1.0) * 100);
        String prosodyRate = (percent >= 0 ? "+" : "") + percent + "%";

        return "<speak version=\"1.0\" xml:lang=\"" + safeLanguage + "\">"
                + "<voice name=\"" + safeVoice + "\">"
                + "<prosody rate=\"" + prosodyRate + "\">"
                + safeText
                + "</prosody></voice></speak>";
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

    private Integer parseInteger(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private String resolveBaseUrl() {
        if (StringUtils.hasText(properties.getAzure().getEndpoint())) {
            return trimTrailingSlash(properties.getAzure().getEndpoint());
        }
        if (!StringUtils.hasText(properties.getAzure().getRegion())) {
            return null;
        }
        return "https://" + properties.getAzure().getRegion() + ".tts.speech.microsoft.com";
    }

    private String trimTrailingSlash(String input) {
        String trimmed = input.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    private String resolveContentType(String outputFormat) {
        if (!StringUtils.hasText(outputFormat)) {
            return "audio/mpeg";
        }

        String format = outputFormat.toLowerCase(Locale.ROOT);
        if (format.contains("riff") || format.contains("wav")) {
            return "audio/wav";
        }
        if (format.contains("ogg")) {
            return "audio/ogg";
        }
        if (format.contains("webm")) {
            return "audio/webm";
        }
        return "audio/mpeg";
    }

    private String escapeXml(String value) {
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }
}
