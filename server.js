{
  "agent_id": "",
  "channel": "voice",
  "last_modification_timestamp": 1757942400000,
  "agent_name": "Erendiz Hotel Reception (Live)",
  "response_engine": { "type": "conversation-flow", "version": 0, "conversation_flow_id": "conversation_flow_erendiz_live_002" },
  "language": "de-DE",
  "opt_out_sensitive_data_storage": false,
  "data_storage_setting": "everything",
  "version": 0,
  "is_published": false,
  "voice_id": "11labs-Anthony",
  "max_call_duration_ms": 3600000,
  "interruption_sensitivity": 0.9,
  "user_dtmf_options": {},
  "retellLlmData": null,

  "conversationFlow": {
    "conversation_flow_id": "conversation_flow_erendiz_live_002",
    "version": 0,
    "global_prompt": "## Identity\nDu bist Anna, die virtuelle Rezeption des Erendiz Hotels in Kemer. Du klingst warm, professionell und hilfsbereit.\n## Stil\n- Kurze Sätze\n- Eine Frage pro Turn\n- Nach Kerndaten einmal bestätigen\n- Bei Unklarheit höflich nachfragen",
    "nodes": [
      {
        "id": "start-node",
        "name": "Welcome",
        "type": "conversation",
        "start_speaker": "agent",
        "instruction": { "type": "static_text", "text": "Willkommen im Erendiz Hotel in Kemer. Möchten Sie eine Buchung anfragen?" },
        "edges": [
          { "id": "e0", "condition": "User wants to book or ask for price", "transition_condition": { "type": "prompt", "prompt": "User wants to book or ask for price" }, "destination_node_id": "node-ask-checkin" }
        ],
        "display_position": { "x": 200, "y": 200 }
      },

      { "id": "node-ask-checkin", "name": "Ask Check-in", "type": "conversation",
        "instruction": { "type": "prompt", "text": "An welchem Tag möchten Sie anreisen?" },
        "edges": [ { "id": "e1", "condition": "User provided check-in", "transition_condition": { "type": "prompt", "prompt": "User provided check-in" }, "destination_node_id": "node-ask-checkout" } ],
        "display_position": { "x": 480, "y": 200 }
      },

      { "id": "node-ask-checkout", "name": "Ask Check-out", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Und an welchem Tag reisen Sie wieder ab?" },
        "edges": [ { "id": "e2", "condition": "User provided check-out", "transition_condition": { "type": "prompt", "prompt": "User provided check-out" }, "destination_node_id": "node-ask-adults" } ],
        "display_position": { "x": 760, "y": 200 }
      },

      { "id": "node-ask-adults", "name": "Ask Adults", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Für wie viele Erwachsene?" },
        "edges": [ { "id": "e3", "condition": "User provided adults", "transition_condition": { "type": "prompt", "prompt": "User provided adults" }, "destination_node_id": "node-ask-children" } ],
        "display_position": { "x": 1040, "y": 200 }
      },

      { "id": "node-ask-children", "name": "Ask Children", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Reisen Kinder mit? Bitte die Zahl sagen." },
        "edges": [ { "id": "e4", "condition": "User provided children", "transition_condition": { "type": "prompt", "prompt": "User provided children" }, "destination_node_id": "node-confirm" } ],
        "display_position": { "x": 1320, "y": 200 }
      },

      { "id": "node-confirm", "name": "Confirm", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Bitte bestätigen: Anreise {{check_in}}, Abreise {{check_out}}, {{adults}} Erwachsene und {{children}} Kinder. Stimmt das?" },
        "edges": [
          { "id": "e5a", "condition": "User confirms", "transition_condition": { "type": "prompt", "prompt": "User confirms" }, "destination_node_id": "node-check-availability" },
          { "id": "e5b", "condition": "User denies",   "transition_condition": { "type": "prompt", "prompt": "User denies" }, "destination_node_id": "node-ask-checkin" }
        ],
        "display_position": { "x": 1600, "y": 200 }
      },

      { "id": "node-check-availability", "name": "Check Availability", "type": "function",
        "tool_type": "local", "tool_id": "tool-check-availability",
        "speak_during_execution": true, "wait_for_result": true,
        "instruction": { "type": "prompt", "text": "Einen Moment, ich prüfe die Verfügbarkeit." },
        "edges": [
          { "id": "avail-ok",   "condition": "Function result", "transition_condition": { "type": "prompt", "prompt": "Function result" }, "destination_node_id": "node-avail-say" },
          { "id": "avail-err",  "condition": "Function error",  "transition_condition": { "type": "prompt", "prompt": "Function error"  }, "destination_node_id": "node-avail-error" }
        ],
        "display_position": { "x": 1880, "y": 200 }
      },

      { "id": "node-avail-say", "name": "Availability Result", "type": "conversation",
        "instruction": { "type": "prompt", "text": "{{availability_ok ? spoken : 'Leider ist an diesen Daten nichts frei.'}}" },
        "edges": [
          { "id": "to-next", "condition": "Continue", "transition_condition": { "type": "prompt", "prompt": "Continue" }, "destination_node_id": "node-avail-next-router" }
        ],
        "display_position": { "x": 2160, "y": 200 }
      },

      { "id": "node-avail-next-router", "name": "Avail Router", "type": "conversation",
        "instruction": { "type": "static_text", "text": "" },
        "edges": [
          { "id": "to-board", "condition": "availability_ok", "transition_condition": { "type": "prompt", "prompt": "availability_ok" }, "destination_node_id": "node-ask-board" },
          { "id": "to-no",    "condition": "availability_not_ok", "transition_condition": { "type": "prompt", "prompt": "availability_not_ok" }, "destination_node_id": "node-no-availability" }
        ],
        "display_position": { "x": 2160, "y": 280 }
      },

      { "id": "node-avail-error", "name": "Availability Error", "type": "conversation",
        "instruction": { "type": "static_text", "text": "Entschuldigung, die Verfügbarkeitsprüfung hat zu lange gedauert. Ich versuche es sofort noch einmal." },
        "edges": [
          { "id": "retry1", "condition": "Retry", "transition_condition": { "type": "prompt", "prompt": "Retry" }, "destination_node_id": "node-check-availability-retry" }
        ],
        "display_position": { "x": 1880, "y": 360 }
      },

      { "id": "node-check-availability-retry", "name": "Check Availability (Retry)", "type": "function",
        "tool_type": "local", "tool_id": "tool-check-availability",
        "speak_during_execution": true, "wait_for_result": true,
        "instruction": { "type": "prompt", "text": "Danke für Ihre Geduld, ich prüfe noch einmal." },
        "edges": [
          { "id": "retry-ok",  "condition": "Function result", "transition_condition": { "type": "prompt", "prompt": "Function result" }, "destination_node_id": "node-avail-say" },
          { "id": "retry-err", "condition": "Function error",  "transition_condition": { "type": "prompt", "prompt": "Function error"  }, "destination_node_id": "node-offer-email" }
        ],
        "display_position": { "x": 2160, "y": 360 }
      },

      { "id": "node-no-availability", "name": "No Availability", "type": "conversation",
        "instruction": { "type": "static_text", "text": "Leider ist an diesen Daten kein Zimmer frei. Möchten Sie andere Daten prüfen?" },
        "edges": [
          { "id": "no-yes", "condition": "User wants alternative dates", "transition_condition": { "type": "prompt", "prompt": "User wants alternative dates" }, "destination_node_id": "node-ask-checkin" },
          { "id": "no-end", "condition": "User ends", "transition_condition": { "type": "prompt", "prompt": "User ends" }, "destination_node_id": "end-node" }
        ],
        "display_position": { "x": 2440, "y": 360 }
      },

      { "id": "node-ask-board", "name": "Ask Board", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Möchten Sie ohne Verpflegung, Frühstück, Halbpension oder Vollpension?" },
        "edges": [ { "id": "e8", "condition": "User provided board", "transition_condition": { "type": "prompt", "prompt": "User provided board" }, "destination_node_id": "node-quote" } ],
        "display_position": { "x": 2440, "y": 200 }
      },

      { "id": "node-quote", "name": "Quote", "type": "function",
        "tool_type": "local", "tool_id": "tool-quote",
        "speak_during_execution": true, "wait_for_result": true,
        "instruction": { "type": "prompt", "text": "Einen Moment, ich berechne den Gesamtpreis." },
        "edges": [
          { "id": "q-ok",  "condition": "Function result", "transition_condition": { "type": "prompt", "prompt": "Function result" }, "destination_node_id": "node-offer-clubcare" },
          { "id": "q-err", "condition": "Function error",  "transition_condition": { "type": "prompt", "prompt": "Function error"  }, "destination_node_id": "node-ask-email-offer" }
        ],
        "display_position": { "x": 2720, "y": 200 }
      },

      { "id": "node-offer-clubcare", "name": "Offer Club&Care", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Gesamtpreis {{price_eur}} Euro (ca. {{price_try}} Lira). Möchten Sie zusätzlich unser Club & Care Paket für 220 Euro?" },
        "edges": [ { "id": "e10", "condition": "User answered club care", "transition_condition": { "type": "prompt", "prompt": "User answered club care" }, "destination_node_id": "node-closing" } ],
        "display_position": { "x": 3000, "y": 200 }
      },

      { "id": "node-closing", "name": "Closing Choice", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Möchten Sie jetzt verbindlich buchen oder soll ich Ihnen ein unverbindliches Angebot per E-Mail senden?" },
        "edges": [
          { "id": "book",  "condition": "User wants to book now", "transition_condition": { "type": "prompt", "prompt": "User wants to book now" }, "destination_node_id": "node-ask-email-book" },
          { "id": "offer", "condition": "User wants email offer",  "transition_condition": { "type": "prompt", "prompt": "User wants email offer" }, "destination_node_id": "node-ask-email-offer" }
        ],
        "display_position": { "x": 3280, "y": 200 }
      },

      { "id": "node-ask-email-book", "name": "Ask Email (Booking)", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Bitte nennen Sie Ihre E-Mail-Adresse für die Buchungsbestätigung." },
        "edges": [ { "id": "to-commit", "condition": "User provided email", "transition_condition": { "type": "prompt", "prompt": "User provided email" }, "destination_node_id": "node-commit" } ],
        "display_position": { "x": 3560, "y": 160 }
      },

      { "id": "node-commit", "name": "Commit Booking", "type": "function",
        "tool_type": "local", "tool_id": "tool-commit",
        "speak_during_execution": true, "wait_for_result": true,
        "instruction": { "type": "prompt", "text": "Einen Moment, ich schließe die Buchung ab." },
        "edges": [
          { "id": "c-ok", "condition": "Function result", "transition_condition": { "type": "prompt", "prompt": "Function result" }, "destination_node_id": "end-node" },
          { "id": "c-er", "condition": "Function error",  "transition_condition": { "type": "prompt", "prompt": "Function error"  }, "destination_node_id": "node-ask-email-offer" }
        ],
        "display_position": { "x": 3840, "y": 160 }
      },

      { "id": "node-ask-email-offer", "name": "Ask Email (Offer)", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Gern. Wie lautet Ihre E-Mail-Adresse? Ich sende Ihnen das Angebot zu." },
        "edges": [ { "id": "to-send-offer", "condition": "User provided email for offer", "transition_condition": { "type": "prompt", "prompt": "User provided email for offer" }, "destination_node_id": "node-send-offer" } ],
        "display_position": { "x": 3560, "y": 260 }
      },

      { "id": "node-send-offer", "name": "Send Offer", "type": "function",
        "tool_type": "local", "tool_id": "tool-send-offer",
        "speak_during_execution": true, "wait_for_result": true,
        "instruction": { "type": "prompt", "text": "Einen Moment, ich sende Ihnen das Angebot." },
        "edges": [ { "id": "o-ok", "condition": "Function result", "transition_condition": { "type": "prompt", "prompt": "Function result" }, "destination_node_id": "end-node" } ],
        "display_position": { "x": 3840, "y": 260 }
      },

      { "id": "node-offer-email", "name": "Fallback Offer", "type": "conversation",
        "instruction": { "type": "prompt", "text": "Es gab ein technisches Problem. Soll ich Ihnen ein unverbindliches Angebot per E-Mail senden?" },
        "edges": [ { "id": "to-email", "condition": "User agrees", "transition_condition": { "type": "prompt", "prompt": "User agrees" }, "destination_node_id": "node-ask-email-offer" } ],
        "display_position": { "x": 2440, "y": 460 }
      },

      { "id": "end-node", "name": "End Call", "type": "end",
        "instruction": { "type": "prompt", "text": "Vielen Dank für Ihren Anruf. Einen schönen Tag und bis bald im Erendiz Hotel!" },
        "display_position": { "x": 4120, "y": 210 }
      }
    ],

    "start_node_id": "start-node",
    "start_speaker": "agent",

    "tools": [
      {
        "name": "check_availability",
        "description": "Prüft Verfügbarkeit basierend auf Datum/Personen (SLIM).",
        "tool_id": "tool-check-availability",
        "type": "custom",
        "url": "https://retell-agent.onrender.com/retell/tool/check_availability_slim",
        "timeout_ms": 12000
      },
      {
        "name": "quote",
        "description": "Berechnet Gesamtpreis in EUR/TRY",
        "tool_id": "tool-quote",
        "type": "custom",
        "url": "https://retell-agent.onrender.com/retell/public/quote",
        "timeout_ms": 12000
      },
      {
        "name": "commit_booking",
        "description": "Bucht verbindlich",
        "tool_id": "tool-commit",
        "type": "custom",
        "url": "https://retell-agent.onrender.com/retell/tool/commit_booking",
        "timeout_ms": 12000
      },
      {
        "name": "send_offer",
        "description": "Schickt ein Angebot per Mail",
        "tool_id": "tool-send-offer",
        "type": "custom",
        "url": "https://retell-agent.onrender.com/retell/tool/send_offer",
        "timeout_ms": 12000
      }
    ],

    "model_choice": { "type": "cascading", "model": "gpt-4.1" },
    "begin_tag_display_position": { "x": 0, "y": 0 },
    "is_published": false,
    "knowledge_base_ids": []
  },

  "llmURL": null
}
