#!/usr/bin/env python
"""Quick test script for Step 3 + Step 4 implementation."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent import run_recommendation_agent


def test_agent():
    """Test the recommendation agent on example indicators."""
    
    test_cases = [
        "I need data on housing affordability and transport accessibility in Madrid city center",
        "Looking for population statistics and employment data for districts in Madrid",
        "Need air quality measurements and health indicators for Madrid neighbourhoods",
    ]
    
    for i, indicator in enumerate(test_cases, 1):
        print(f"\n{'='*70}")
        print(f"Test Case {i}")
        print(f"{'='*70}")
        print(f"Indicator: {indicator}\n")
        
        result = run_recommendation_agent(indicator)
        
        # Display results
        print("PARSED INDICATOR:")
        parsed = result.get("parsed_indicator", {})
        print(f"  Geographic Level: {parsed.get('geographic_level', 'unknown')}")
        print(f"  Time Frame: {parsed.get('time_frame', 'unknown')}")
        print(f"  Population: {parsed.get('population', '(none)')}")
        print(f"  Attributes: {', '.join(parsed.get('attributes', []))}")
        
        print("\nEXTRACTED THEMES:")
        theme_conf = result.get("theme_confidence", {})
        if theme_conf:
            for theme, confidence in theme_conf.items():
                print(f"  {theme}: {confidence}")
        else:
            print("  (none)")
        
        print("\nCANDIDATE DATASETS (before scoring):")
        candidates = result.get("candidate_datasets", [])
        print(f"  Total candidates: {len(candidates)}")
        for cand in candidates[:3]:
            print(f"  • {cand['title']}: {cand['matching_themes']}")
        
        print("\nRECOMMENDATIONS:")
        scored = result.get("scored_recommendations", [])
        print(f"  Total scored: {len(scored)}")
        if scored:
            for rec in scored[:3]:  # Show top 3
                essential_tag = " [ESSENTIAL]" if rec.get("is_essential") else ""
                print(f"  • {rec['title']}{essential_tag}")
                print(f"    Theme Match: {rec['theme_match_score']} | Quality: {rec['quality_score']} | Final: {rec['final_score']}")
                print(f"    Matching: {', '.join(rec['matching_themes'])}")
        else:
            print("  (none)")
        
        print("\nESSENTIAL RECOMMENDATIONS:")
        essential = result.get("essential_recommendations", [])
        if essential:
            for rec in essential:
                print(f"  • {rec['title']}")
        else:
            print("  (none)")
        
        print("\nGAPS:")
        gaps = result.get("gaps", [])
        if gaps:
            for gap in gaps:
                print(f"  • {gap['theme_id']}: {gap['description']}")
        else:
            print("  (none)")
        
        print("\nRISKS:")
        risks = result.get("risks", [])
        if risks:
            for risk in risks[:3]:  # Show first 3
                print(f"  {risk}")
        else:
            print("  (none)")
        
        print("\nDEBUG TRACE:")
        trace = result.get("debug_trace", [])
        if trace:
            for msg in trace:
                print(f"  → {msg}")
        else:
            print("  (empty)")
        
        print("\nERRORS:")
        errors = result.get("errors", [])
        if errors:
            for err in errors:
                print(f"  ! {err}")
        else:
            print("  (none)")


def test_embeddings_extraction():
    # Embedding-based tests removed — project uses keyword-only extraction now.
    return 0, 0


def test_agent_with_embeddings():
    # Deprecated - embeddings removed. No-op.
    return 0, 0


if __name__ == "__main__":
    try:
        test_agent()
        print("\n✅ Tests completed (embedding tests removed).")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
