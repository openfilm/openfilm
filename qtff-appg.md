<!--
{
  "documentType" : "article",
  "framework" : "quicktime-file-format",
  "identifier" : "/documentation/QuickTime-File-Format/Appendix_G_Audio_priming_handling_encoder_delay_in_AAC",
  "metadataVersion" : "0.1.0",
  "role" : "collectionGroup",
  "title" : "Audio priming-handling encoder delay in AAC"
}
-->

# Audio priming-handling encoder delay in AAC

Position a source audio signal in a sound track to handle encoder delay.

## Overview

This section describes temporal positioning of a source audio signal after AAC encoding into a sound track for QuickTime media files. The mechanisms described here are specified in ISO MPEG-4 standards (ISO/IEC 14496-12, 2008) and are used here with additional constraints.

> Note: AAC implementations typically represent 1024 PCM audio samples in one AAC packet (synonymous in this context with a QuickTime media sample, and also referred to in ISO documents as an “access unit”). The terms “sample” and “audio sample” in this appendix are used to refer to PCM samples. For the encoded audio data, the terms “AAC packet” and QuickTime “media sample” are used.

## Topics

### Handling encoder delay

[AAC encoding background](/documentation/QuickTime-File-Format/Background_AAC_encoding)

AAC requires data beyond the source PCM audio samples in order to correctly encode and decode audio samples due to the nature of the encoding algorithm.

[The timing and synchronization problem](/documentation/QuickTime-File-Format/The_timing_and_synchronization_problem)

Trim the silent priming samples to preserve correct synchronization.

[Historical solution for implicit encoder delay](/documentation/QuickTime-File-Format/Historical_solution_implicit_encoder_delay)

Implicit encoder delay uses the most common delay of 2112 audio samples.

[Using track structures to represent encoder delay explicitly](/documentation/QuickTime-File-Format/Using_track_structures_to_represent_encode_delay_explictly)

Represent encoder delay explicitly with an edit list atom and sample group structures.

[Representing encoder delay explicitly](/documentation/QuickTime-File-Format/Example_representing_encoder_delay_explicitly)

Review an example that represents the temporal position of 5 seconds of 48kHz PCM audio encoded in a 48kHz AAC sound track.

[Representing encoder delay with track structures](/documentation/QuickTime-File-Format/Summary_using_track_structures_to_represent_encoder_delay)

Use sample group structures to represent encoder delay for AAC sound tracks.



---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)