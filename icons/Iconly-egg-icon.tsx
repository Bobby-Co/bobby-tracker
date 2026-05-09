
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlyEgg = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M20.7989 14.0301C20.8335 18.0225 17.4317 21.6883 13.0606 21.9858C8.71233 22.2822 4.81183 19.1107 4.27532 14.823C4.01031 12.7148 4.49274 10.7159 5.27695 8.77968C6.12606 6.6834 7.27479 4.7775 9.07036 3.34321C11.3386 1.53033 13.7313 1.54331 15.9801 3.38972C18.0244 5.06739 19.2326 7.3032 20.0796 9.75859C20.5144 11.0166 20.7708 12.3146 20.7989 14.0301ZM9.41406 14.1901C9.41406 12.4853 10.7957 11.104 12.499 11.104C14.2035 11.104 15.585 12.4855 15.585 14.1901C15.585 15.8946 14.2035 17.2761 12.499 17.2761C10.7957 17.2761 9.41406 15.8948 9.41406 14.1901Z" fill={secondColor}></path>
		</svg>
    ) 
}