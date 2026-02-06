package org.booklore.model.dto.request.tts;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class TtsSynthesisRequest {

    @NotBlank
    private String provider;

    @NotBlank
    private String text;

    private String voiceId;
    private String language;

    @DecimalMin("0.5")
    @DecimalMax("3.0")
    private Double rate = 1.0;
}
