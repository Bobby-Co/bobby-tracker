
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlyPin = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M12.5 13.225C10.979 13.225 9.741 11.987 9.741 10.466C9.741 8.945 10.979 7.707 12.5 7.707C14.021 7.707 15.258 8.945 15.258 10.466C15.258 11.987 14.021 13.225 12.5 13.225ZM12.5 2.5C8.075 2.5 4.474 6.101 4.474 10.527C4.474 16.163 11.066 21.5 12.5 21.5C13.934 21.5 20.526 16.163 20.526 10.527C20.526 6.101 16.925 2.5 12.5 2.5Z" fill={secondColor}></path>
		</svg>
    ) 
}