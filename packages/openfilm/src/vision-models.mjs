/** Sources, licenses and exact bytes travel with the application; inference never uses a remote service. */
export const VISION_MODELS = Object.freeze({
  'person.tflite': {
    bytes: 250177,
    bundled: true,
    license: 'Apache-2.0',
    sha256: '490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite',
  },
  'face.task': {
    bytes: 3758596,
    bundled: true,
    license: 'Apache-2.0',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  'portrait.onnx': {
    bytes: 12984781,
    bundled: true,
    license: 'Apache-2.0',
    sha256: '25f165da9bfd30830a575f1f0490f1acd995975cb349bc02f3d79332e1fe5cf6',
    url: 'https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model_fp16.onnx',
  },
  'subject.onnx': {
    bytes: 98484532,
    bundled: false,
    license: 'MIT',
    sha256: 'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516',
    url: 'https://huggingface.co/studioludens/birefnet-lite-512/resolve/962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model_fp16.onnx',
  },
  'refine.onnx': {
    bytes: 103885865, bundled: false, license: 'Apache-2.0',
    sha256: 'bf28d2e0be2c073286e88d60ad649d7123da2749a2d99133fd1098d5887e0225',
    url: 'https://huggingface.co/Xenova/vitmatte-small-composition-1k/resolve/6bc1297f6140f055a227b6d2cfe8c093281f35d2/onnx/model.onnx',
  },
  'face-parse.onnx': {
    bytes: 53205364, bundled: false, license: 'MIT',
    sha256: '0d9bd318e46987c3bdbfacae9e2c0f461cae1c6ac6ea6d43bbe541a91727e33f',
    url: 'https://github.com/yakhyo/face-parsing/releases/download/weights/resnet18.onnx',
  },
});
