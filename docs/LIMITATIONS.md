# Limitations

FocusVerify is an assistive monitoring prototype, not a cheating detector. The current build records browser focus, page visibility, fullscreen transitions, and browser camera-track status; it does not implement computer-vision inference.

- browser APIs report limited signals and do not provide visibility outside the active browser context
- camera stream availability does not establish face presence, eye visibility, gaze direction, or identity
- camera resolution and frame-rate values are not currently used to make behavioral inferences
- false positives and false negatives are possible
- human review remains necessary

The calibration route is a visual sequence preview; it does not estimate gaze or persist calibration samples. Signals should never be treated as proof of misconduct or as an automated decision.
