
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlySimcard = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M12.7485 16.4192H13.8025C14.5855 16.4192 14.7025 15.8052 14.7025 15.4392V14.6792H12.7485V16.4192Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M9.2934 12.4195V13.1795H11.2484V11.4395H10.1934C9.3814 11.4395 9.2934 12.1245 9.2934 12.4195Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M9.2934 15.4392C9.2934 15.8052 9.4104 16.4192 10.1934 16.4192H11.2484V14.6792H9.2934V15.4392Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M16.2025 15.439C16.2025 16.9 15.2155 17.919 13.8025 17.919H10.1935C8.78051 17.919 7.79351 16.9 7.79351 15.439V12.419C7.79351 10.959 8.78051 9.939 10.1935 9.939H13.8025C15.2155 9.939 16.2025 10.959 16.2025 12.419V15.439ZM19.1045 7.233L15.3115 3.282C14.8315 2.785 14.1615 2.5 13.4735 2.5H8.40551C6.07851 2.5 4.18451 4.392 4.18451 6.719V17.28C4.18451 19.607 6.07751 21.5 8.40451 21.5H15.5955C17.9225 21.5 19.8155 19.607 19.8155 17.28V9C19.8155 8.335 19.5625 7.709 19.1045 7.233Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M13.8021 11.439H12.7481V13.179H14.7021V12.419C14.7021 12.125 14.6141 11.439 13.8021 11.439Z" fill={secondColor}></path>
		</svg>
    ) 
}