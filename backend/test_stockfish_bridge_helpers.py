import unittest

import chess
import chess.engine

import stockfish_bridge


class StockfishBridgeHelperTests(unittest.TestCase):
    def test_detect_phase_endgame(self):
        board = chess.Board("4k3/8/8/8/8/8/4K3/8 w - - 0 1")
        self.assertEqual(stockfish_bridge._detect_phase(board), "endgame")

    def test_extract_position_facts_reports_hanging_pieces(self):
        board = chess.Board("4k3/8/8/8/8/8/R3q3/4K3 w - - 0 1")
        facts = stockfish_bridge._extract_position_facts(board)

        self.assertEqual(facts["side_to_move"], "white")
        self.assertIn("rook on a2", facts["white_hanging_pieces"])
        self.assertEqual(facts["white_hanging_count"], 1)

    def test_extract_candidate_lines_computes_score_loss(self):
        board = chess.Board()
        infos = [
            {"pv": [chess.Move.from_uci("g1f3")], "score": chess.engine.PovScore(chess.engine.Cp(50), chess.WHITE)},
            {"pv": [chess.Move.from_uci("e2e4")], "score": chess.engine.PovScore(chess.engine.Cp(20), chess.WHITE)},
        ]

        candidates = stockfish_bridge._extract_candidate_lines(board, infos)

        self.assertEqual(candidates[0]["san"], "Nf3")
        self.assertEqual(candidates[0]["score_loss_cp"], 0)
        self.assertEqual(candidates[1]["score_loss_cp"], 30)

    def test_build_position_profile_adds_plan_hints(self):
        board = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
        profile = stockfish_bridge._build_position_profile(board, approved_moves=["Nf3", "e4"])

        self.assertEqual(profile["phase"], "opening")
        self.assertIn("If you need a concrete move, stay close to the engine-approved shortlist.", profile["plan_hints"])
        self.assertIn("white_minor_pieces_developed", profile["development"])


if __name__ == "__main__":
    unittest.main()
