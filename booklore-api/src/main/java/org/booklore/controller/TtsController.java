package org.booklore.controller;

import org.booklore.model.dto.request.tts.TtsSynthesisRequest;
import org.booklore.model.dto.response.tts.TtsProviderVoicesResponse;
import org.booklore.model.dto.response.tts.TtsProvidersResponse;
import org.booklore.service.tts.CloudTtsService;
import org.booklore.service.tts.TtsSynthesisResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/v1/tts")
@RequiredArgsConstructor
@Tag(name = "Reader TTS", description = "Provider-based text-to-speech endpoints for the ebook reader")
public class TtsController {

    private final CloudTtsService cloudTtsService;

    @Operation(summary = "Get TTS providers", description = "Returns configured cloud TTS providers and availability status.")
    @ApiResponse(responseCode = "200", description = "Providers returned successfully")
    @GetMapping("/providers")
    public ResponseEntity<TtsProvidersResponse> getProviders() {
        return ResponseEntity.ok(cloudTtsService.getProviders());
    }

    @Operation(summary = "Get provider voices", description = "Returns available voices for a cloud TTS provider.")
    @ApiResponse(responseCode = "200", description = "Voices returned successfully")
    @GetMapping("/providers/{providerId}/voices")
    public ResponseEntity<TtsProviderVoicesResponse> getVoices(
            @Parameter(description = "Provider id (azure|google|piper)") @PathVariable String providerId,
            @Parameter(description = "Optional language filter prefix, e.g. en or en-US") @RequestParam(required = false) String language) {
        return ResponseEntity.ok(cloudTtsService.getVoices(providerId, language));
    }

    @Operation(summary = "Synthesize speech", description = "Synthesizes text using the selected TTS provider and returns audio bytes.")
    @ApiResponse(responseCode = "200", description = "Speech synthesized successfully")
    @PostMapping(value = "/synthesize", consumes = MediaType.APPLICATION_JSON_VALUE, produces = {"audio/mpeg", "audio/wav"})
    public ResponseEntity<byte[]> synthesize(@Valid @RequestBody TtsSynthesisRequest request) {
        TtsSynthesisResult result = cloudTtsService.synthesize(request);
        byte[] audio = result.audio();
        String contentType = result.contentType() != null ? result.contentType() : "audio/mpeg";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(contentType));
        headers.setContentLength(audio.length);
        headers.setCacheControl(CacheControl.noStore().mustRevalidate().cachePrivate().sMaxAge(0, TimeUnit.SECONDS));

        return ResponseEntity.ok().headers(headers).body(audio);
    }
}
