/*
	Displays text with a tooltip on mouse hover, with optional color.
	Writers can wrap the call in <b>, <u>, etc. for their own formatting.

	Usage:

	{TOOLTIP("mysterious figure", "You don't recognize them", "")}
	{TOOLTIP("blood", "Careful where you step", "red")}

*/

=== function TOOLTIP(text, tooltip, color)
	{color:
		~ return "<span class='ink-tooltip' title='" + tooltip + "'><font color='" + color + "'>" + text + "</font></span>"
	- else:
		~ return "<span class='ink-tooltip' title='" + tooltip + "'>" + text + "</span>"
	}


