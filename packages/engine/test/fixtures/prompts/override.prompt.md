---
name: override-demo
---
<system>
You order context yourself.
</system>

<context>
{% if config.context.documents %}<documents>{{ config.context.documents }}</documents>{% endif %}
{% if config.context.memory %}<memory>{{ config.context.memory }}</memory>{% endif %}
</context>
