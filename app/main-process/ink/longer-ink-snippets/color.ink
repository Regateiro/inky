/*
	Displays text in a given color.

	Usage:

	{COLOR("blood", "red")}
	{COLOR("sky", "blue")}

*/

=== function COLOR(text, color)
	~ return "<font color='" + color + "'>" + text + "</font>"
