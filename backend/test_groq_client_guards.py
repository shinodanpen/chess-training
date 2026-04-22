import unittest
from unittest import mock

import groq_client


START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


class GroqClientGuardTests(unittest.TestCase):
    def test_structured_schema_for_two_sentence_outputs(self):
        schema = groq_client._structured_output_schema("coach_comment", sentence_fields=2)
        payload_schema = schema["json_schema"]["schema"]

        self.assertEqual(schema["type"], "json_schema")
        self.assertTrue(schema["json_schema"]["strict"])
        self.assertEqual(
            payload_schema["required"],
            ["sentence_1", "sentence_2", "mentions_concrete_move"],
        )
        self.assertFalse(payload_schema["additionalProperties"])

    def test_render_structured_sentences_ignores_empty_fields(self):
        payload = {
            "sentence_1": "Your king is still exposed",
            "sentence_2": "",
            "mentions_concrete_move": False,
        }

        self.assertEqual(
            groq_client._render_structured_sentences(payload, sentence_fields=2, max_sentences=2),
            "Your king is still exposed.",
        )

    def test_legal_san_advice_is_allowed(self):
        self.assertTrue(groq_client._contains_concrete_move_advice("Consider Nf3."))
        self.assertTrue(groq_client._move_advice_is_legal(START_FEN, "Consider Nf3."))

    def test_illegal_san_advice_is_rejected(self):
        self.assertTrue(groq_client._contains_concrete_move_advice("Consider Bb5."))
        self.assertFalse(groq_client._move_advice_is_legal(START_FEN, "Consider Bb5."))

    def test_piece_to_square_advice_is_rejected_when_blocked(self):
        self.assertTrue(groq_client._contains_concrete_move_advice("Move your bishop to b5."))
        self.assertFalse(groq_client._move_advice_is_legal(START_FEN, "Move your bishop to b5."))

    def test_piece_to_square_advice_is_allowed_when_legal(self):
        self.assertTrue(groq_client._contains_concrete_move_advice("Move your knight to f3."))
        self.assertTrue(groq_client._move_advice_is_legal(START_FEN, "Move your knight to f3."))

    def test_castling_advice_is_rejected_when_not_legal(self):
        self.assertTrue(groq_client._contains_concrete_move_advice("You should castle kingside."))
        self.assertFalse(groq_client._move_advice_is_legal(START_FEN, "You should castle kingside."))

    def test_piece_reference_without_advice_is_not_flagged(self):
        fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 2 3"
        self.assertFalse(groq_client._contains_concrete_move_advice("Your bishop on c4 is active and points at f7."))
        self.assertIn("Legal moves for Black", groq_client._legal_moves_context(fen))

    def test_extract_first_san_from_text(self):
        self.assertEqual(groq_client._extract_first_san_from_text("You can play Nf3 here."), "Nf3")
        self.assertEqual(groq_client._extract_first_san_from_text("Improve your pieces."), "")

    @mock.patch("groq_client.stockfish_bridge.is_chat_move_sane")
    def test_chat_move_sanity_guard_uses_engine_result(self, mock_is_chat_move_sane):
        mock_is_chat_move_sane.return_value = {
            "legal": True,
            "sane": False,
            "score_loss_cp": 320,
            "best_move": "g1f3",
            "candidate_move": "b1c3",
        }

        self.assertFalse(groq_client._chat_move_advice_is_sane(START_FEN, "Nc3"))

    @mock.patch("groq_client.stockfish_bridge.is_chat_move_sane")
    def test_chat_move_sanity_guard_rejects_move_outside_approved_shortlist(self, mock_is_chat_move_sane):
        self.assertFalse(groq_client._chat_move_advice_is_sane(START_FEN, "Nc3", approved_moves=["Nf3", "e4"]))
        mock_is_chat_move_sane.assert_not_called()


if __name__ == "__main__":
    unittest.main()
