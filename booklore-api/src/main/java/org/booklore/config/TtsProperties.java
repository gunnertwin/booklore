package org.booklore.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.tts")
@Getter
@Setter
public class TtsProperties {

    private boolean enabled = true;
    private int maxTextLength = 1800;
    private Azure azure = new Azure();
    private Google google = new Google();
    private Piper piper = new Piper();

    @Getter
    @Setter
    public static class Azure {
        private boolean enabled = false;
        private String apiKey;
        private String region;
        private String endpoint;
        private String defaultVoice = "en-US-AvaNeural";
        private String outputFormat = "audio-24khz-48kbitrate-mono-mp3";
    }

    @Getter
    @Setter
    public static class Google {
        private boolean enabled = false;
        private String apiKey;
        private String endpoint = "https://texttospeech.googleapis.com";
        private String defaultVoice = "en-US-Neural2-F";
    }

    @Getter
    @Setter
    public static class Piper {
        private boolean enabled = false;
        private String baseUrl = "http://piper:5000";
        private String defaultVoice;
    }
}
