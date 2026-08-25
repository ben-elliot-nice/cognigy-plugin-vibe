---
topic: output-formats
description: api.say() channel output shapes — quick replies, buttons, gallery, image, audio, adaptive card
---

## output-formats — Code Node Channel Output Formats

Use with `api.say(text, data)` in code nodes. All formats use the `_cognigy._default` structure,
which Cognigy adapts per channel.

### Text Only

api.say('Hello, how can I help?')

### Quick Replies

api.say('What would you like to do?', {
\_cognigy: { \_default: { \_quickReplies: {
type: 'quick_replies',
text: 'What would you like to do?',
quickReplies: [
{ contentType: 'postback', payload: 'check_balance', title: 'Check Balance' },
{ contentType: 'postback', payload: 'transfer', title: 'Transfer Money' },
{ contentType: 'trigger_intent', payload: 'help', title: 'Get Help' }
]
}}}
})

contentType options: postback | phone_number | trigger_intent

### Buttons

api.say('Choose an option:', {
\_cognigy: { \_default: { \_buttons: {
type: 'buttons',
text: 'Choose an option:',
buttons: [
{ type: 'postback', payload: 'yes', title: 'Yes' },
{ type: 'postback', payload: 'no', title: 'No' },
{ type: 'web_url', url: 'https://example.com', title: 'Learn More' },
{ type: 'phone_number', payload: '+61400000000', title: 'Call Us' }
]
}}}
})

### Gallery (Carousel)

api.say('', {
\_cognigy: { \_default: { \_gallery: {
type: 'carousel',
items: [
{
title: 'Product One',
subtitle: 'Great product',
imageUrl: 'https://example.com/image1.jpg',
buttons: [{ type: 'postback', payload: 'buy_one', title: 'Buy Now' }]
}
]
}}}
})

### Image

api.say('', {
\_cognigy: { \_default: { \_image: {
type: 'image',
imageUrl: 'https://example.com/image.jpg'
}}}
})

### Audio

api.say('', {
\_cognigy: { \_default: { \_audio: {
type: 'audio',
audioUrl: 'https://example.com/audio.wav'
}}}
})

### Video

api.say('', {
\_cognigy: { \_default: { \_video: {
type: 'video',
videoUrl: 'https://www.youtube.com/watch?v=example'
}}}
})

### List

api.say('', {
\_cognigy: { \_default: { \_list: {
type: 'list',
items: [
{
title: 'Item One',
subtitle: 'Description',
imageUrl: 'https://example.com/img.jpg',
buttons: [{ type: 'postback', payload: 'select_one', title: 'Select' }]
}
],
button: { type: 'postback', payload: 'view_all', title: 'View All' }
}}}
})

### Adaptive Card

api.say('', {
\_cognigy: { \_default: { \_adaptiveCard: {
type: 'adaptiveCard',
adaptiveCard: {
type: 'AdaptiveCard',
version: '1.0',
body: [
{ type: 'TextBlock', text: 'Hello World', weight: 'bolder', size: 'medium' }
],
actions: [
{ type: 'Action.Submit', title: 'OK', data: { action: 'ok' } }
]
}
}}}
})
